/**
 * The Downloads screen (a Settings sub-page): the download preferences and the SERIES list — ordered
 * queue-first then most-recent, each row showing a progress radial while in flight and swipe/hover
 * actions that match its state (Cancel an in-flight download, Resume a paused one, Delete a finished
 * one). Tapping a series opens its own download screen (`series-downloads.tsx`) with the chapter
 * roster — there is no inline foldout anymore. The storage bar + size accounting live on the Storage
 * screen; this page is management.
 *
 * This reads the `/downloads` storage tree through `api.ts`; a backend without the module yields an
 * empty tree. Mutations (delete/cancel/resume) go to the HOST's download engine — embedded or remote
 * server — which owns the blobs and aborts in-flight work; this screen only prunes the offline index
 * and refetches. The Wi-Fi/background toggles are device policies for the embedded engine, so they
 * only render in embedded mode (a remote server paces its own downloads).
 */
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openConfirm } from '@/components/confirm-popup';
import { Holdable } from '@/components/context-menu';
import { DownloadStatusIndicator } from '@/components/downloads/download-status-indicator';
import { seriesActions, seriesCan } from '@/components/downloads/row-actions';
import { SeriesStorageBar } from '@/components/downloads/series-storage-bar';
import { CheckIcon, ClearIcon, PauseIcon, PlayIcon, TrashIcon } from '@/components/icons/ui-icons';
import {
  PILL_HEIGHT,
  SelectLead,
  SelectOptionsTrigger,
  SelectPillBar,
  SelectToggle,
  useDragSelect,
  useSelectMode,
} from '@/components/multi-select/select-mode';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsSection } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, SettingsGutter, SettingsRowHeight, Spacing } from '@/constants/theme';
import { dlDeleteChapter, dlDeleteSeries, dlStorageUsage } from '@/data/api';
import { applyBackgroundDownloads } from '@/data/downloads/background';
import { getResolvedModeSync } from '@/data/embedded/preference';
import { bySortValue, deriveSeriesState, seriesFraction, seriesSortValue } from '@/data/downloads/derive';
import { kickDownloads, pauseSeries, resumeSeriesDownload, retryChapter } from '@/data/downloads/engine';
import { forgetChapter, forgetSeries } from '@/data/downloads/index-cache';
import { formatBytes } from '@/data/downloads/format';
import { downloadPrefs$, useDownloadPrefs } from '@/data/downloads/prefs';
import { queryClient } from '@/data/query-client';
import { queryKeys } from '@/data/queries';
import { hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import type { StorageUsage, StorageUsageSeries } from '@comical/downloads';

const EMPTY_USAGE: StorageUsage = { totalBytes: 0, seriesCount: 0, chapterCount: 0, pageCount: 0, bySeries: [] };

/**
 * One list row — a series. Row objects are REUSED from `cache` while their `s` snapshot is identical,
 * so when one entry ticks only that row gets a fresh object — every other row keeps its reference and
 * LegendList (and the compiler-memoized renderItem) skip re-rendering it. Tapping a row opens the
 * per-series download screen (`/series-downloads`), which owns the chapter roster.
 */
interface DlRow {
  key: string;
  s: StorageUsageSeries;
}

function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
}

const seriesKey = (s: { bridgeId: string; seriesId: string }) => `${s.bridgeId}:${s.seriesId}`;

/** The series list, queue-first then most-recent, with per-row object identity kept via `cache`. */
function buildRows(bySeries: StorageUsageSeries[], cache: Map<string, DlRow>): DlRow[] {
  const ordered = [...bySeries].sort((a, b) => bySortValue(seriesSortValue(a.chapters), seriesSortValue(b.chapters)));
  const rows: DlRow[] = [];
  const live = new Set<string>();
  for (const s of ordered) {
    const key = seriesKey(s);
    live.add(key);
    const prev = cache.get(key);
    const row: DlRow = prev && prev.s === s ? prev : { key, s };
    cache.set(key, row);
    rows.push(row);
  }
  for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
  return rows;
}

export default function DownloadsScreen() {
  const { paddingTop, paddingBottom } = useSettingsScrollPadding();
  const { width } = useWindowDimensions();
  const { wifiOnly, background } = useDownloadPrefs();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Full-width scroller (scrollbar at the window edge); rows centered within the settings column via
  // symmetric side padding — LegendList ignores maxWidth/alignSelf on its content container, so the
  // centring has to be explicit. Rows escape `SettingsGutter` to reach the column's edge for their pills.
  const sidePad = SettingsGutter + Math.max(0, (width - MaxContentWidth) / 2);
  const theme = useTheme();

  // Caches row objects across renders so an unchanged row keeps the SAME reference — the basis for
  // LegendList skipping its re-render (see `buildRows` / the `DlRow` note). A state-held Map
  // (stable instance, populated during render's own computation) rather than a ref, which must not
  // be read during render.
  const [rowCache] = useState(() => new Map<string, DlRow>());

  const { data: usage = EMPTY_USAGE } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    queryFn: () => dlStorageUsage().catch(() => EMPTY_USAGE),
  });

  // Opening this screen nudges the queue to drain — a safety net so a download that didn't resume at
  // boot (or was held back) starts moving while you're watching it, rather than sitting idle.
  useEffect(() => {
    kickDownloads();
  }, []);

  // The host's engine unlinks the blobs itself (its delete routes return `files: []`); this side
  // only drops the sync offline-index entries and refetches.
  const deleteSeries = async (s: StorageUsageSeries) => {
    await dlDeleteSeries(s.bridgeId, s.seriesId);
    forgetSeries(s.bridgeId, s.seriesId);
    refresh();
  };
  const deleteChapter = async (bridgeId: string, seriesId: string, chapterId: string) => {
    await dlDeleteChapter(bridgeId, seriesId, chapterId);
    forgetChapter(bridgeId, seriesId, chapterId);
    refresh();
  };
  // Retrying a whole series re-queues each of its failed chapters.
  const retrySeries = (s: StorageUsageSeries) => {
    for (const c of s.chapters) if (c.state === 'failed') void retryChapter(c.bridgeId, c.seriesId, c.chapterId);
  };
  // Cancel a series' in-flight downloads: stop them, then discard the incomplete chapters (their
  // partial bytes). Completed chapters are kept — so the series drops to complete-only (or is removed
  // if nothing finished), and its swipe naturally becomes Delete.
  const cancelSeriesInflight = async (s: StorageUsageSeries) => {
    await pauseSeries(s.bridgeId, s.seriesId);
    for (const c of s.chapters) {
      if (c.state !== 'complete') await deleteChapter(c.bridgeId, c.seriesId, c.chapterId);
    }
  };

  const rows = buildRows(usage.bySeries, rowCache);

  // ── Multi-select mode (the shared select-mode chrome) — bulk-manage SERIES here ──
  const mode = useSelectMode();
  const selecting = mode.selecting;
  const allKeys = useMemo(() => rows.map((r) => r.key), [rows]);
  const ms = useMultiSelect(allKeys);
  const listExtra = useMemo(() => ({ selected: ms.selected, selecting }), [ms.selected, selecting]);
  const toggleSelecting = () => {
    if (selecting) ms.clear();
    mode.toggle();
  };

  // iOS-style circle drag-select (sweep the check rail; auto-scrolls near the edges).
  const listRef = useRef<LegendListRef>(null);
  const scrollYRef = useRef(0);
  const dragSelect = useDragSelect({
    keys: allKeys,
    selected: ms.selected,
    selectOnly: ms.selectOnly,
    rowHeight: SettingsRowHeight,
    scrollRef: listRef,
    scrollYRef,
  });
  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;
  const stagingRows = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('downloads.menu', 'all'),
    },
  ];

  // Contextual bulk verbs over the selected SERIES — the SAME per-state rules as the rows' swipe
  // actions (`seriesCan`, row-actions.tsx): Delete only for settled series (complete/paused/failed),
  // Cancel for in-flight ones (discards their incomplete chapters, keeps the finished),
  // Pause/Resume for in-flight/paused.
  const picked = rows.filter((r) => ms.selected.has(r.key));
  const stateOf = (s: StorageUsageSeries) => deriveSeriesState(s.chapters);
  const toPause = picked.filter((r) => seriesCan.pause(stateOf(r.s)));
  const toResume = picked.filter((r) => seriesCan.resume(stateOf(r.s)));
  const toCancel = picked.filter((r) => seriesCan.cancel(stateOf(r.s)));
  const toDelete = picked.filter((r) => seriesCan.delete(stateOf(r.s)));
  const pauseSelected = () => {
    for (const r of toPause) void pauseSeries(r.s.bridgeId, r.s.seriesId);
  };
  const resumeSelected = () => {
    for (const r of toResume) void resumeSeriesDownload(r.s.bridgeId, r.s.seriesId);
  };
  const cancelSelected = async () => {
    for (const r of toCancel) await cancelSeriesInflight(r.s);
    ms.clear();
    mode.exit();
  };
  const deleteSelected = async () => {
    for (const r of toDelete) await deleteSeries(r.s);
    ms.clear();
    mode.exit();
  };
  const confirmDeleteSeries = (s: StorageUsageSeries) =>
    openConfirm({
      message: `"${s.title}" and its ${s.chapterCount} downloaded chapter${s.chapterCount === 1 ? '' : 's'} will be deleted from this device.`,
      confirmLabel: 'Delete Series',
      onConfirm: () => void deleteSeries(s),
    });
  const confirmDeleteSelected = () =>
    openConfirm({
      message: `${toDelete.length} series and their downloaded chapters will be deleted from this device.`,
      confirmLabel: `Delete ${toDelete.length} Series`,
      onConfirm: () => void deleteSelected(),
    });

  const openSeries = (s: StorageUsageSeries) =>
    router.push({
      pathname: '/series-downloads',
      params: {
        bridgeId: s.bridgeId,
        id: s.seriesId,
        title: s.title,
        ...(s.thumbnailUrl ? { cover: s.thumbnailUrl } : {}),
        ...(s.author ? { author: s.author } : {}),
      },
    });

  // Progress is read from the manifest query, which the engine now patches page-by-page (see
  const header = (
    <View style={styles.header}>
      {/* Total downloaded + a per-series colour breakdown of that space (top 10 + "Other"). Replaces
          the old cumulative progress radial — per-row radials already show in-flight progress.
          ALWAYS rendered (an empty track + "0 B" when nothing is downloaded): the page keeps a
          stable shape, and a fresh download grows the bar in place instead of popping a widget in. */}
      <View style={styles.storage}>
        <SeriesStorageBar bySeries={usage.bySeries} totalBytes={usage.totalBytes} />
      </View>
      {/* Wi-Fi/background gate the DEVICE engine — meaningless when a remote server owns the
          downloads (it paces itself), so the section only renders in embedded mode. */}
      {getResolvedModeSync() === 'embedded' && (
        <SettingsSection>
          <SettingsToggleRow
            label="Download over Wi-Fi only"
            description="Hold downloads until you're on Wi-Fi."
            value={wifiOnly}
            onChange={(v) => {
              downloadPrefs$.wifiOnly.set(v);
              // Turning the gate off (or changing it) should resume held-back downloads right away.
              kickDownloads();
            }}
          />
          <SettingsToggleRow
            label="Download in background"
            description="Continue in OS-granted windows after leaving the app."
            value={background}
            onChange={(v) => {
              downloadPrefs$.background.set(v);
              applyBackgroundDownloads(v);
            }}
          />
        </SettingsSection>
      )}
    </View>
  );

  const renderItem = ({ item, index }: { item: DlRow; index: number }) => {
    const { s } = item;
    const state = deriveSeriesState(s.chapters);
    const frac = seriesFraction(s.chapters);
    return (
      <View>
        <Holdable
          enabled={selecting}
          onHold={() => {
            hapticSelection();
            ms.rangeFill(item.key);
          }}>
          {({ onLongPress }) => (
            <SwipeableSettingsRow
              recycleKey={item.key}
              swipeEnabled={!selecting}
              label={s.title}
              labelBold
              description={`${s.chapterCount} chapter${s.chapterCount === 1 ? '' : 's'} · ${formatBytes(s.bytes)}`}
              leading={
                <>
                  <SelectLead
                    progress={mode.progress}
                    selected={ms.selected.has(item.key)}
                    edgeOffset={sidePad}
                    gesture={selecting ? dragSelect.gestureFor(index) : undefined}
                  />
                  <DownloadStatusIndicator
                    state={state}
                    fraction={frac}
                    size={22}
                    interactive={false}
                    onPause={() => void pauseSeries(s.bridgeId, s.seriesId)}
                    onResume={() => void resumeSeriesDownload(s.bridgeId, s.seriesId)}
                    onRetry={() => retrySeries(s)}
                  />
                </>
              }
              onPress={selecting ? () => ms.toggle(item.key) : () => openSeries(s)}
              onLongPress={selecting ? onLongPress : undefined}
              actions={seriesActions(state, {
                onPause: () => void pauseSeries(s.bridgeId, s.seriesId),
                onResume: () => void resumeSeriesDownload(s.bridgeId, s.seriesId),
                onRetry: () => retrySeries(s),
                onCancel: () => void cancelSeriesInflight(s),
                onDelete: () => confirmDeleteSeries(s),
              })}
            />
          )}
        </Holdable>
        {/* Every row except the last carries the standard inset hairline at its bottom edge —
            absolutely positioned so the row stays exactly `SettingsRowHeight` tall. */}
        {index < rows.length - 1 && (
          <View pointerEvents="none" style={[styles.divider, { backgroundColor: theme.hairline }]} />
        )}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title={selecting ? `${ms.count} selected` : 'Downloads'}
        left={selecting ? <SelectOptionsTrigger rows={stagingRows} testID="downloads.select-options" /> : undefined}
        right={<SelectToggle selecting={selecting} onToggle={toggleSelecting} testID="downloads.select-toggle" />}
      />
      <LegendList
        ref={listRef}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        style={styles.list}
        data={rows}
        keyExtractor={(r) => r.key}
        // Recycle row views instead of mounting/unmounting a fresh gesture+reanimated swipe stack for
        // every row that scrolls into view (the heavy part); the swipe row resets its gesture state on
        // recycle via `recycleKey`.
        recycleItems
        estimatedItemSize={SettingsRowHeight}
        // Every row is exactly one settings-row tall, so declare it KNOWN — LegendList then skips
        // measuring each row after render (the main source of this list's lag vs. the grid pages, which
        // are fixed-size too). With sizes known, also stop retro-correcting scroll offset from
        // measurements, which otherwise adds a flinging jitter. Mirrors `RecyclerList`.
        getFixedItemSize={() => SettingsRowHeight}
        maintainVisibleContentPosition={{ data: false, size: false }}
        // Selection lives OUTSIDE the row objects (identity-cached — see `buildRows`); this tells
        // the list to repaint visible rows when the selection set or the mode changes.
        extraData={listExtra}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No downloads yet. Open a series and tap Download to keep chapters for offline reading.
          </ThemedText>
        }
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop,
          // Room for the floating pills while selecting, so the last rows can scroll clear of them.
          paddingBottom: paddingBottom + (selecting ? PILL_HEIGHT + Spacing.six : 0),
          paddingLeft: sidePad,
          paddingRight: sidePad,
        }}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />

      {/* The floating contextual bulk verbs (shared select-mode chrome), over the selected SERIES. */}
      {selecting && (
        <SelectPillBar
          left={sidePad}
          right={sidePad}
          bottom={Math.max(insets.bottom, Spacing.three)}
          verbs={[
            ...(toPause.length > 0
              ? [{ key: 'pause', label: `Pause ${toPause.length} series`, Icon: PauseIcon, onPress: pauseSelected, testID: 'downloads.pause' }]
              : []),
            ...(toResume.length > 0
              ? [{ key: 'resume', label: `Resume ${toResume.length} series`, Icon: PlayIcon, onPress: resumeSelected, testID: 'downloads.resume' }]
              : []),
            ...(toCancel.length > 0
              ? [{ key: 'cancel', label: `Cancel ${toCancel.length} in-flight series`, Icon: ClearIcon, color: theme.danger, onPress: () => void cancelSelected(), testID: 'downloads.cancel' }]
              : []),
            ...(toDelete.length > 0
              ? [{ key: 'delete', label: `Delete ${toDelete.length} series`, Icon: TrashIcon, color: theme.danger, onPress: confirmDeleteSelected, testID: 'downloads.delete' }]
              : []),
          ]}
        />
      )}
    </ThemedView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  header: {
    // Space between the preferences and the first series row (was the ScrollView's inter-section gap).
    paddingBottom: Spacing.five,
  },
  storage: {
    // A little breathing room over the big total (matching the Storage page), plus space below before
    // the toggles. The bar component adds the rest of its own internal padding.
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  empty: {
    paddingHorizontal: Spacing.three,
    textAlign: 'center',
  },
  // The rows' bottom hairline (see `renderItem`): starts at the gutter (aligned under the row's text)
  // and runs off the right edge to the row's own escaped extent — the same inset-divider look as
  // `SettingsSection`. Absolute so it adds no height to the fixed-size rows.
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: -SettingsGutter,
    height: StyleSheet.hairlineWidth,
  },
});
