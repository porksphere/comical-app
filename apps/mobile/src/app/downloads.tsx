/**
 * The unified Downloads screen (a Settings sub-page): the download preferences and an expandable
 * series → chapters breakdown — ordered queue-first then most-recent, each row showing a progress
 * radial while in flight and swipe/hover actions that match its state (Cancel an in-flight download,
 * Resume a paused one, Delete a finished one). The storage bar + size accounting live on the Storage
 * screen; this page is management.
 *
 * The tree is **virtualized** (LegendList): the series + their expanded chapters are FLATTENED into one
 * list so only on-screen rows mount — expanding a long series no longer mounts every chapter's swipe
 * row at once. Series rows are bold with an animated foldout chevron; chapter rows are indented under
 * their parent. Recycling is off — each swipe row keeps its own gesture state.
 *
 * This reads the `/downloads` storage tree through `api.ts`; a backend without the module yields an
 * empty tree. Mutations (delete/cancel/resume) go to the HOST's download engine — embedded or remote
 * server — which owns the blobs and aborts in-flight work; this screen only prunes the offline index
 * and refetches. The Wi-Fi/background toggles are device policies for the embedded engine, so they
 * only render in embedded mode (a remote server paces its own downloads).
 */
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { DownloadStatusIndicator } from '@/components/downloads/download-status-indicator';
import { SeriesStorageBar } from '@/components/downloads/series-storage-bar';
import { ChevronRightIcon, ClearIcon, PauseIcon, PlayIcon, RetryIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsSection } from '@/components/settings/settings-row';
import { SwipeableSettingsRow, type SwipeRowAction } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, SettingsGutter, SettingsRowHeight, Spacing } from '@/constants/theme';
import { dlDeleteChapter, dlDeleteSeries, dlStorageUsage } from '@/data/api';
import { applyBackgroundDownloads } from '@/data/downloads/background';
import { getResolvedModeSync } from '@/data/embedded/preference';
import {
  bySortValue,
  chapterSortValue,
  deriveSeriesState,
  displayChapterState,
  seriesFraction,
  seriesSortValue,
} from '@/data/downloads/derive';
import {
  kickDownloads,
  pauseChapter,
  pauseSeries,
  resumeChapterDownload,
  resumeSeriesDownload,
  retryChapter,
} from '@/data/downloads/engine';
import { forgetChapter, forgetSeries } from '@/data/downloads/index-cache';
import { formatBytes } from '@/data/downloads/format';
import { downloadPrefs$, useDownloadPrefs } from '@/data/downloads/prefs';
import { queryClient } from '@/data/query-client';
import { queryKeys } from '@/data/queries';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import type { DownloadState, StorageUsage, StorageUsageSeries } from '@comical/downloads';

const EMPTY_USAGE: StorageUsage = { totalBytes: 0, seriesCount: 0, chapterCount: 0, pageCount: 0, bySeries: [] };

type DlChapter = StorageUsageSeries['chapters'][number];
/**
 * One flattened list row. `open` lives on the series row (not read from `expanded` in render) so that a
 * row's object changes ONLY when its own data or open-state changes — that stable identity lets
 * LegendList (and the compiler-memoized renderItem) skip re-rendering unchanged rows when one entry
 * updates. Chapters carry no parent `s`: their handlers key off the chapter's own bridge/series ids, so
 * a series-level rollup change doesn't churn every chapter row. See `buildRows`.
 */
type DlRow =
  | { kind: 'series'; key: string; s: StorageUsageSeries; open: boolean }
  | { kind: 'chapter'; key: string; c: DlChapter };

function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
}

const seriesKey = (s: { bridgeId: string; seriesId: string }) => `${s.bridgeId}:${s.seriesId}`;

/**
 * Flatten the storage tree into the virtualized list — each series (queue-first, then most-recent),
 * followed by its chapters (finished-first, then queue order) while it's expanded — REUSING each row's
 * object from `cache` when its inputs are unchanged. A series row is reused while its `s` snapshot and
 * open-state are identical; a chapter row while its `c` snapshot is identical. So when one entry ticks,
 * only that row (and its series' rollup) gets a fresh object — every other row keeps its reference and
 * LegendList leaves it untouched. `cache` is pruned to the rows still present.
 */
function buildRows(bySeries: StorageUsageSeries[], expanded: Set<string>, cache: Map<string, DlRow>): DlRow[] {
  const ordered = [...bySeries].sort((a, b) => bySortValue(seriesSortValue(a.chapters), seriesSortValue(b.chapters)));
  const rows: DlRow[] = [];
  const live = new Set<string>();
  for (const s of ordered) {
    const key = seriesKey(s);
    live.add(key);
    const open = expanded.has(key);
    const prev = cache.get(key);
    const row: DlRow =
      prev && prev.kind === 'series' && prev.s === s && prev.open === open ? prev : { kind: 'series', key, s, open };
    cache.set(key, row);
    rows.push(row);
    if (open) {
      const chapters = [...s.chapters].sort((a, b) => bySortValue(chapterSortValue(a), chapterSortValue(b)));
      for (const c of chapters) {
        const ckey = `${key}:${c.chapterId}`;
        live.add(ckey);
        const cprev = cache.get(ckey);
        const crow: DlRow = cprev && cprev.kind === 'chapter' && cprev.c === c ? cprev : { kind: 'chapter', key: ckey, c };
        cache.set(ckey, crow);
        rows.push(crow);
      }
    }
  }
  for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
  return rows;
}

interface RowHandlers {
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  /** Discard the in-flight download (series: drop the incomplete chapters; chapter: delete it). */
  onCancel: () => void;
  onDelete: () => void;
}

// Actions are laid out left→right and the LAST one sits at the swipe edge (revealed FIRST). So the
// primary action (Pause/Resume/Retry) goes LAST (nearest the edge), and the destructive one
// (Cancel/Delete) goes FIRST (further to the left) — you reach Pause with a short swipe, the
// destructive action only with a longer one.
const PAUSE = (onPress: () => void): SwipeRowAction => ({ label: 'Pause', icon: PauseIcon, onPress });
const RESUME = (onPress: () => void): SwipeRowAction => ({ label: 'Resume', icon: PlayIcon, onPress });
const RETRY = (onPress: () => void): SwipeRowAction => ({ label: 'Retry', icon: RetryIcon, onPress });
const CANCEL = (onPress: () => void): SwipeRowAction => ({ label: 'Cancel', icon: ClearIcon, destructive: true, onPress });
const DELETE = (onPress: () => void): SwipeRowAction => ({ label: 'Delete', icon: TrashIcon, destructive: true, onPress });

/** Series swipe actions: while downloading you get Pause + Cancel (Cancel discards the in-flight
 *  downloads, after which the series is complete-only → Delete). */
function seriesActions(state: DownloadState, h: RowHandlers): SwipeRowAction[] {
  if (state === 'complete') return [DELETE(h.onDelete)];
  if (state === 'paused') return [DELETE(h.onDelete), RESUME(h.onResume)];
  if (state === 'failed') return [DELETE(h.onDelete), RETRY(h.onRetry)];
  return [CANCEL(h.onCancel), PAUSE(h.onPause)]; // downloading / queued
}

/** Chapter swipe actions: a chapter is atomic, so its destructive action is always Delete. */
function chapterActions(state: DownloadState, h: RowHandlers): SwipeRowAction[] {
  if (state === 'complete') return [DELETE(h.onDelete)];
  if (state === 'paused') return [DELETE(h.onDelete), RESUME(h.onResume)];
  if (state === 'failed') return [DELETE(h.onDelete), RETRY(h.onRetry)];
  return [DELETE(h.onDelete), PAUSE(h.onPause)]; // downloading / queued
}

export default function DownloadsScreen() {
  const { paddingTop, paddingBottom } = useSettingsScrollPadding();
  const { width } = useWindowDimensions();
  const { wifiOnly, background } = useDownloadPrefs();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Full-width scroller (scrollbar at the window edge); rows centered within the settings column via
  // symmetric side padding — LegendList ignores maxWidth/alignSelf on its content container, so the
  // centring has to be explicit. Rows escape `SettingsGutter` to reach the column's edge for their pills.
  const sidePad = SettingsGutter + Math.max(0, (width - MaxContentWidth) / 2);

  // Deep-link / series-button focus: expand a series and scroll it into view.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const listRef = useRef<LegendListRef>(null);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  // Caches flattened row objects across renders so an unchanged row keeps the SAME reference — the
  // basis for LegendList skipping its re-render (see `buildRows` / the `DlRow` note).
  const rowCache = useRef<Map<string, DlRow>>(new Map());

  const { data: usage = EMPTY_USAGE } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    queryFn: () => dlStorageUsage().catch(() => EMPTY_USAGE),
  });

  useEffect(() => {
    if (!focus) return;
    setExpanded((prev) => new Set(prev).add(focus));
    setPendingScroll(focus);
  }, [focus]);

  // Opening this screen nudges the queue to drain — a safety net so a download that didn't resume at
  // boot (or was held back) starts moving while you're watching it, rather than sitting idle.
  useEffect(() => {
    kickDownloads();
  }, []);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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

  const rows = buildRows(usage.bySeries, expanded, rowCache.current);

  // Once the focused series is in the flattened rows (after its expand lands), bring it into view.
  useEffect(() => {
    if (!pendingScroll) return;
    const idx = rows.findIndex((r) => r.kind === 'series' && r.key === pendingScroll);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({ index: idx, animated: true });
      setPendingScroll(null);
    }
  }, [pendingScroll, rows]);

  // Progress is read from the manifest query, which the engine now patches page-by-page (see
  const header = (
    <View style={styles.header}>
      {/* Total downloaded + a per-series colour breakdown of that space (top 10 + "Other"). Replaces
          the old cumulative progress radial — per-row radials already show in-flight progress. */}
      {usage.seriesCount > 0 && (
        <View style={styles.storage}>
          <SeriesStorageBar bySeries={usage.bySeries} totalBytes={usage.totalBytes} />
        </View>
      )}
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

  const renderItem = ({ item }: { item: DlRow }) => {
    if (item.kind === 'series') {
      const { s, open } = item;
      const state = deriveSeriesState(s.chapters);
      const frac = seriesFraction(s.chapters);
      return (
        <SwipeableSettingsRow
          recycleKey={item.key}
          label={s.title}
          labelBold
          description={`${s.chapterCount} chapter${s.chapterCount === 1 ? '' : 's'} · ${formatBytes(s.bytes)}`}
          leading={
            <DownloadStatusIndicator
              state={state}
              fraction={frac}
              size={22}
              interactive={false}
              onPause={() => void pauseSeries(s.bridgeId, s.seriesId)}
              onResume={() => void resumeSeriesDownload(s.bridgeId, s.seriesId)}
              onRetry={() => retrySeries(s)}
            />
          }
          right={<FoldoutChevron open={open} />}
          onPress={() => toggle(item.key)}
          actions={seriesActions(state, {
            onPause: () => void pauseSeries(s.bridgeId, s.seriesId),
            onResume: () => void resumeSeriesDownload(s.bridgeId, s.seriesId),
            onRetry: () => retrySeries(s),
            onCancel: () => void cancelSeriesInflight(s),
            onDelete: () => void deleteSeries(s),
          })}
        />
      );
    }
    const { c } = item;
    // All read from the per-page-patched manifest: completed pages, bytes, and state advance together,
    // so the radial, the "X/Y" count, and the size can never disagree and update every page.
    const cState = displayChapterState(c);
    const cFrac = c.pageCount > 0 ? c.completedPages / c.pageCount : 0;
    return (
      <SwipeableSettingsRow
        recycleKey={item.key}
        label={c.chapterName ?? (c.number !== undefined ? `Chapter ${c.number}` : c.chapterId)}
        description={chapterDescription(c, cState, c.completedPages, c.bytes)}
        contentInset={Spacing.five}
        leading={
          <DownloadStatusIndicator
            state={cState}
            fraction={cFrac}
            size={20}
            onPause={() => void pauseChapter(c.bridgeId, c.seriesId, c.chapterId)}
            onResume={() => void resumeChapterDownload(c.bridgeId, c.seriesId, c.chapterId)}
            onRetry={() => void retryChapter(c.bridgeId, c.seriesId, c.chapterId)}
          />
        }
        actions={chapterActions(cState, {
          onPause: () => void pauseChapter(c.bridgeId, c.seriesId, c.chapterId),
          onResume: () => void resumeChapterDownload(c.bridgeId, c.seriesId, c.chapterId),
          onRetry: () => void retryChapter(c.bridgeId, c.seriesId, c.chapterId),
          onCancel: () => void deleteChapter(c.bridgeId, c.seriesId, c.chapterId),
          onDelete: () => void deleteChapter(c.bridgeId, c.seriesId, c.chapterId),
        })}
      />
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Downloads" />
      <LegendList
        ref={listRef}
        style={styles.list}
        data={rows}
        keyExtractor={(r) => r.key}
        // Recycle row views instead of mounting/unmounting a fresh gesture+reanimated swipe stack for
        // every row that scrolls into view (the heavy part). `getItemType` pools series and chapter
        // containers separately so a series view only ever recycles into another series (same shape),
        // and the swipe row resets its gesture state on recycle via `useRecyclingEffect`.
        recycleItems
        getItemType={(r) => r.kind}
        estimatedItemSize={SettingsRowHeight}
        // Every row is exactly one settings-row tall, so declare it KNOWN — LegendList then skips
        // measuring each row after render (the main source of this list's lag vs. the grid pages, which
        // are fixed-size too). With sizes known, also stop retro-correcting scroll offset from
        // measurements, which otherwise adds a flinging jitter. Mirrors `RecyclerList`.
        getFixedItemSize={() => SettingsRowHeight}
        maintainVisibleContentPosition={{ data: false, size: false }}
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
          paddingBottom,
          paddingLeft: sidePad,
          paddingRight: sidePad,
        }}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />
    </ThemedView>
  );
}

/** The series row's trailing foldout arrow: a right chevron that rotates down as the series expands. */
function FoldoutChevron({ open }: { open: boolean }) {
  const theme = useTheme();
  const p = useDerivedValue(() => withTiming(open ? 1 : 0, { duration: 180 }));
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${p.value * 90}deg` }] }));
  return (
    <Animated.View style={style}>
      <ChevronRightIcon color={theme.textSecondary} size={18} />
    </Animated.View>
  );
}

function chapterDescription(c: DlChapter, state: DownloadState, shownDone: number, shownBytes: number): string {
  const size = `${c.pageCount} page${c.pageCount === 1 ? '' : 's'} · ${formatBytes(shownBytes)}`;
  if (state === 'complete') return size;
  const label = state === 'downloading' ? `${shownDone}/${c.pageCount}` : state;
  return `${size} · ${label}`;
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
});
