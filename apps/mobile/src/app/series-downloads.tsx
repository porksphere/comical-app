/**
 * One series' downloads — the consolidated per-series download screen. The Downloads page's series
 * rows open it (no more inline foldout), and the series page's Download button / card menu open the
 * SAME screen — one place where a series' chapters are watched, managed, and (de)queued.
 *
 * Two entry flavours, one behavior:
 *  - From the Downloads page (`all` unset): the manifest's chapters only — status radials, live
 *    progress, and the standard swipe actions per row. Exactly what the old foldout showed.
 *  - From a series (`all=1`): the FULL logical chapter list, downloaded and not — undownloaded rows
 *    carry a muted download glyph and their release date. `select=1` additionally opens in
 *    multi-select (the series Download button's intent: pick chapters, download).
 *
 * Multi-select (top-right toggle): check circles animate in on the left, pushing row content right;
 * swipe actions are disabled entirely while active. A fixed strip offers the live count plus
 * "Select all" / "Select unread" staging, and the pinned footer holds the two bulk verbs — Download
 * (enqueues the selection's not-yet-kept chapters; failed ones retry) and Delete (removes the
 * selection's downloaded ones). Range-fill long-press works like every multi-select list (through
 * `Holdable` — a bare Pressable long-press doesn't fire inside iOS scroll views).
 */
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openConfirm } from '@/components/confirm-popup';
import { Holdable } from '@/components/context-menu';
import { DownloadStatusIndicator } from '@/components/downloads/download-status-indicator';
import { chapterActions, chapterCan } from '@/components/downloads/row-actions';
import {
  CheckIcon,
  ClearIcon,
  DownloadingIcon,
  DownloadsIcon,
  EyeIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
} from '@/components/icons/ui-icons';
import {
  PILL_HEIGHT,
  SelectLead,
  SelectPillBar,
  SelectToggle,
  useDragSelect,
  useSelectMode,
} from '@/components/multi-select/select-mode';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, SettingsGutter, SettingsRowHeight, Spacing } from '@/constants/theme';
import { dlDeleteChapter, dlGetSeries } from '@/data/api';
import { bySortValue, chapterSortValue, displayChapterState } from '@/data/downloads/derive';
import {
  enqueueChapters,
  kickDownloads,
  pauseChapter,
  resumeChapterDownload,
  retryChapter,
} from '@/data/downloads/engine';
import { formatBytes } from '@/data/downloads/format';
import { forgetChapter } from '@/data/downloads/index-cache';
import { selectableGroups, toEnqueue } from '@/data/downloads/select';
import { relativeTime } from '@/data/mock';
import { queryClient } from '@/data/query-client';
import { queryKeys, seriesListQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { hapticSelection } from '@/lib/haptics';
import { usePreferredGroup } from '@/lib/preferred-group';
import { testId } from '@/lib/test-id';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import type { ChapterGroup } from '@/lib/chapter-order';
import type { DownloadedChapter, DownloadState } from '@comical/downloads';

/**
 * One chapter row: a manifest chapter, a not-yet-downloaded logical chapter, or both merged.
 * Selection deliberately is NOT a field — rows keep a stable object identity across selection taps
 * AND download ticks (see the identity cache below), and `renderItem` reads the live selection set
 * directly (LegendList repaints visible rows via `extraData`).
 */
interface RosterRow {
  key: string;
  name: string;
  desc: string;
  /** The manifest record, when this chapter is downloaded/tracked — drives status + swipe actions. */
  c?: DownloadedChapter;
  /** The logical chapter (series entry only) — the identity a fresh enqueue downloads. */
  group?: ChapterGroup;
  unread: boolean;
}

function chapterDescription(c: DownloadedChapter, state: DownloadState): string {
  // A lazily-enqueued chapter has no page list yet (it resolves when the engine picks it up) —
  // "0 pages · 0 B · queued" would read as an error, so show just the state until the count lands.
  if (c.pageCount === 0 && state !== 'complete') return state;
  const size = `${c.pageCount} page${c.pageCount === 1 ? '' : 's'} · ${formatBytes(c.bytes)}`;
  if (state === 'complete') return size;
  const label = state === 'downloading' ? `${c.completedPages}/${c.pageCount}` : state;
  return `${size} · ${label}`;
}

/** The manifest record to show for a logical chapter (best across the group's versions). */
function bestManifest(versionIds: string[], manifest: DownloadedChapter[]): DownloadedChapter | undefined {
  const rank: Record<DownloadState, number> = { complete: 4, downloading: 3, queued: 2, paused: 1, failed: 0 };
  let best: DownloadedChapter | undefined;
  for (const d of manifest) {
    if (versionIds.includes(d.chapterId) && (!best || rank[d.state] > rank[best.state])) best = d;
  }
  return best;
}

export default function SeriesDownloadsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The standard settings-screen top inset (top bar + SettingsTopGap) — the same gap every
  // fixed-row-height list starts at, so this screen can't drift from the Downloads page's.
  const { paddingTop } = useSettingsScrollPadding();
  const { width } = useWindowDimensions();
  const ds = useDataSource();
  const mock = useMockActive();
  const preferredGroup = usePreferredGroup();

  // `bridgeId` is the machine id (series.tsx's `bridge` is a display name). `all=1` = include the
  // series' full chapter list (the series-page entry); `select=1` = open in multi-select.
  const params = useLocalSearchParams<{
    bridgeId: string;
    id: string;
    title?: string;
    cover?: string;
    author?: string;
    all?: string;
    select?: string;
  }>();
  const bridgeId = params.bridgeId ?? '';
  const seriesId = params.id ?? '';
  const showAll = params.all === '1';

  const { data: dlData } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });
  const manifest = useMemo(() => dlData?.chapters ?? [], [dlData]);
  const title = params.title ?? dlData?.series.title ?? 'Downloads';
  const cover = params.cover ?? dlData?.series.thumbnailUrl;
  const author = params.author ?? dlData?.series.author;

  // The full chapter list — only fetched for the series-page entry (a cache hit there).
  const { data: fetched } = useQuery(seriesListQuery(ds, mock, bridgeId, seriesId, false, showAll && !!seriesId));
  const chapters = fetched?.chapters;

  const router = useRouter();

  // ── Multi-select mode (the shared select-mode chrome) ────────────────────────
  // `forcedSelect` = opened as the series' Download intent (`select=1`): select mode is on and
  // CAN'T be turned off (the toggle is hidden — the back button is the way out). Downloading then
  // closes the page IF the visit was purely "pick and download"; but if the user did any management
  // (pause/resume/cancel/delete) first, the visit became a management session, so we stay put.
  const forcedSelect = params.select === '1';
  const mode = useSelectMode(forcedSelect);
  const selecting = mode.selecting;
  const [didManage, setDidManage] = useState(false);

  // Opening this screen nudges the queue to drain — same safety net as the Downloads page.
  useEffect(() => {
    kickDownloads();
  }, []);

  // ── Rows ──────────────────────────────────────────────────────────────────────
  // Series entry: every logical chapter in ascending reading order, merged with its manifest state.
  // Downloads entry: the manifest's chapters in the Downloads page's finished-first order.
  const sel = useMemo(
    () => (showAll && chapters ? selectableGroups(chapters, manifest) : undefined),
    [showAll, chapters, manifest],
  );
  // Row objects are REUSED from `rowCache` while their rendered content is unchanged: a page event
  // patches ONE chapter object in the manifest (the query cache patch keeps every other chapter's
  // identity), so only the ticking chapter's row gets a fresh object. Without this, every progress
  // tick rebuilt all N row objects and LegendList re-rendered every visible row several times a
  // second — which made the select-mode animation stutter during an active download. A state-held
  // Map (stable instance, populated during the memo's own computation) rather than a ref, which
  // must not be read during render.
  const [rowCache] = useState(() => new Map<string, RosterRow>());
  const rows: RosterRow[] = useMemo(() => {
    const reuse = (next: RosterRow): RosterRow => {
      const prev = rowCache.get(next.key);
      const keep =
        prev && prev.c === next.c && prev.desc === next.desc && prev.name === next.name && prev.unread === next.unread;
      const row = keep ? prev : next;
      rowCache.set(next.key, row);
      return row;
    };
    if (sel) {
      return sel.map((s) => {
        const c = bestManifest(s.group.versions.map((v) => v.id), manifest);
        return reuse({
          key: s.group.key,
          name: s.group.name,
          desc: c ? chapterDescription(c, displayChapterState(c)) : relativeTime(s.group.versions[0]?.date ?? 0),
          ...(c ? { c } : {}),
          group: s.group,
          unread: s.unread,
        });
      });
    }
    return [...manifest]
      .sort((a, b) => bySortValue(chapterSortValue(a), chapterSortValue(b)))
      .map((c) =>
        reuse({
          key: c.chapterId,
          name: c.chapterName ?? (c.number !== undefined ? `Chapter ${c.number}` : c.chapterId),
          desc: chapterDescription(c, displayChapterState(c)),
          c,
          unread: false,
        }),
      );
  }, [sel, manifest, rowCache]);

  const allKeys = useMemo(() => rows.map((r) => r.key), [rows]);
  const unreadKeys = useMemo(() => rows.filter((r) => r.unread && !r.c).map((r) => r.key), [rows]);
  const ms = useMultiSelect(allKeys);
  // Stable until the selection set or mode actually changes — an inline literal would change
  // identity every render and make the list repaint all rows on every download tick.
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
    selectSet: ms.selectSet,
    rowHeight: SettingsRowHeight,
    scrollRef: listRef,
    scrollYRef,
  });

  // The series-page Download intent (`select=1`): once the chapter list lands, STAGE the default
  // pick — every unread chapter not already marked for download — so the button's most common
  // outcome is one tap away. Deferred a tick: this reacts to the list ARRIVING (async data).
  const [preselectPending, setPreselectPending] = useState(params.select === '1');
  useEffect(() => {
    if (!preselectPending || !sel) return;
    const t = setTimeout(() => {
      if (unreadKeys.length > 0) ms.selectOnly(unreadKeys);
      setPreselectPending(false);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectPending, sel]);

  // ── Bulk verbs (the floating pills, select mode only) ─────────────────────────
  // Each verb surfaces only while the selection makes it valid, using the SAME per-state rules as
  // the rows' swipe actions (`chapterCan` — see row-actions.tsx): Delete only for settled chapters
  // (complete/paused/failed — an actively downloading one must be paused first), Cancel for queued
  // ones, Pause/Resume for in-flight/paused. Download stays the enqueue verb.
  const picked = rows.filter((r) => ms.selected.has(r.key));
  const toDownload = picked.filter((r) => (r.group ? !r.c || r.c.state === 'failed' : r.c?.state === 'failed'));
  const toPause = picked.filter((r) => r.c && chapterCan.pause(r.c.state));
  const toResume = picked.filter((r) => r.c && chapterCan.resume(r.c.state));
  const toCancel = picked.filter((r) => r.c && chapterCan.cancel(r.c.state));
  const toDelete = picked.filter((r) => r.c && chapterCan.delete(r.c.state));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.seriesDownloads(bridgeId, seriesId) });
  };

  // After a bulk action settles: on the Downloads-page entry, leave select mode (the toggle owns
  // it); on the forced series entry, stay in select mode (it can't be turned off) and just clear
  // the acted-on selection so the user can keep managing.
  const afterBulkAction = () => {
    if (forcedSelect) ms.clear();
    else toggleSelecting();
  };
  // Any of these makes the visit a "management session" (see `forcedSelect`).
  const markManaged = () => setDidManage(true);

  const downloadSelected = () => {
    const groups = toDownload.filter((r) => r.group).map((r) => r.group!);
    if (groups.length > 0) {
      enqueueChapters(
        { bridgeId, seriesId, title, ...(cover && { thumbnailUrl: cover }), ...(author && { author }) },
        toEnqueue(groups, preferredGroup),
      );
    }
    // Manifest-only failed rows (Downloads-page entry) have no bridge chapter to enqueue — retry them.
    for (const r of toDownload) {
      if (!r.group && r.c) void retryChapter(r.c.bridgeId, r.c.seriesId, r.c.chapterId);
    }
    // A pure "pick and download" trip from a series ends by returning to that series; a trip where
    // the user also managed downloads stays open (they're clearly here to manage).
    if (forcedSelect && !didManage) {
      router.back();
      return;
    }
    afterBulkAction();
  };

  // Pause/resume KEEP the selection (unlike download/delete): they only flip state, and the natural
  // follow-up ("pause these, now delete them") acts on the same chapters.
  const pauseSelected = () => {
    markManaged();
    for (const r of toPause) void pauseChapter(r.c!.bridgeId, r.c!.seriesId, r.c!.chapterId);
  };
  const resumeSelected = () => {
    markManaged();
    for (const r of toResume) void resumeChapterDownload(r.c!.bridgeId, r.c!.seriesId, r.c!.chapterId);
  };

  // Delete and Cancel are the same removal under the hood (the manifest cascade drops queued
  // entries and downloaded bytes alike) — the split is PRESENTATION, mirroring the swipe actions:
  // an X for "never started", a trash can for "on disk".
  const removeChapters = async (targets: RosterRow[]) => {
    markManaged();
    for (const r of targets) {
      const c = r.c!;
      await dlDeleteChapter(c.bridgeId, c.seriesId, c.chapterId).catch(() => {});
      forgetChapter(c.bridgeId, c.seriesId, c.chapterId);
    }
    invalidate();
    afterBulkAction();
  };
  const deleteSelected = () => removeChapters(toDelete);
  const cancelSelected = () => removeChapters(toCancel);
  const confirmDeleteSelected = () =>
    openConfirm({
      message: `${toDelete.length} chapter${toDelete.length === 1 ? '' : 's'} will be deleted from this device.`,
      confirmLabel: toDelete.length === 1 ? 'Delete Chapter' : `Delete ${toDelete.length} Chapters`,
      onConfirm: () => void deleteSelected(),
    });
  const confirmDeleteChapter = (name: string, c: DownloadedChapter) =>
    openConfirm({
      message: `"${name}" will be deleted from this device.`,
      confirmLabel: 'Delete Chapter',
      onConfirm: () => void deleteChapterRow(c),
    });

  // Full-width scroller centered within the settings column (same treatment as the Downloads page).
  const sidePad = SettingsGutter + Math.max(0, (width - MaxContentWidth) / 2);

  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;

  // The staging menu rows (top-left three-dot trigger, replacing the back button in select mode).
  const stagingRows = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('series.dl.menu', 'all'),
    },
    ...(showAll
      ? [
          {
            label: 'Select unread',
            Icon: EyeIcon,
            loading: false,
            disabled: unreadKeys.length === 0,
            onPress: () => ms.selectOnly(unreadKeys),
            testID: testId('series.dl.menu', 'unread'),
          },
        ]
      : []),
  ];

  const deleteChapterRow = async (c: DownloadedChapter) => {
    await dlDeleteChapter(c.bridgeId, c.seriesId, c.chapterId).catch(() => {});
    forgetChapter(c.bridgeId, c.seriesId, c.chapterId);
    invalidate();
  };

  const renderItem = ({ item, index }: { item: RosterRow; index: number }) => {
    const cState = item.c ? displayChapterState(item.c) : undefined;
    const row = (
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
            testID={testId('series.dl.row', item.key)}
            label={item.name}
            description={item.desc}
            leading={
              <>
                <SelectLead
                  progress={mode.progress}
                  selected={ms.selected.has(item.key)}
                  itemKey={item.key}
                  edgeOffset={sidePad}
                  gesture={selecting ? dragSelect.gestureFor(index) : undefined}
                />
                {item.c && cState ? (
                  <DownloadStatusIndicator
                    state={cState}
                    fraction={item.c.pageCount > 0 ? item.c.completedPages / item.c.pageCount : 0}
                    size={20}
                    interactive={!selecting}
                    onPause={() => void pauseChapter(item.c!.bridgeId, item.c!.seriesId, item.c!.chapterId)}
                    onResume={() => void resumeChapterDownload(item.c!.bridgeId, item.c!.seriesId, item.c!.chapterId)}
                    onRetry={() => void retryChapter(item.c!.bridgeId, item.c!.seriesId, item.c!.chapterId)}
                  />
                ) : (
                  // Not downloaded: a muted glyph keeps the label rail aligned with tracked rows.
                  <View style={styles.undownloaded}>
                    <DownloadingIcon color={theme.textSecondary} size={18} />
                  </View>
                )}
              </>
            }
            right={selecting ? <View /> : undefined /* suppress the auto chevron a pressable row grows */}
            onPress={selecting ? () => ms.toggle(item.key) : undefined}
            onLongPress={selecting ? onLongPress : undefined}
            actions={
              item.c && cState
                ? chapterActions(cState, {
                    onPause: () => void pauseChapter(item.c!.bridgeId, item.c!.seriesId, item.c!.chapterId),
                    onResume: () => void resumeChapterDownload(item.c!.bridgeId, item.c!.seriesId, item.c!.chapterId),
                    onRetry: () => void retryChapter(item.c!.bridgeId, item.c!.seriesId, item.c!.chapterId),
                    onCancel: () => void deleteChapterRow(item.c!),
                    onDelete: () => confirmDeleteChapter(item.name, item.c!),
                  })
                : []
            }
          />
        )}
      </Holdable>
    );
    return (
      <View>
        {row}
        {index < rows.length - 1 && (
          <View pointerEvents="none" style={[styles.divider, { backgroundColor: theme.hairline }]} />
        )}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      {/* The back button always shows (the staging "…" lives in the bottom-left pill now); select
          mode just swaps the title for the live count. The mode toggle is hidden on the forced
          series-download entry — there the back button is the only way out. */}
      <TopBar
        title={selecting ? `${ms.count} selected` : title}
        right={forcedSelect ? undefined : <SelectToggle selecting={selecting} onToggle={toggleSelecting} testID="series.dl.select-toggle" />}
      />

      <LegendList
        ref={listRef}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        // A ref write only (no setState → no re-render); 16ms keeps the drag-select scroll math
        // tracking manual scrolling accurately without spamming.
        scrollEventThrottle={16}
        style={styles.list}
        data={rows}
        keyExtractor={(r) => r.key}
        recycleItems
        estimatedItemSize={SettingsRowHeight}
        getFixedItemSize={() => SettingsRowHeight}
        maintainVisibleContentPosition={{ data: false, size: false }}
        // Selection lives OUTSIDE the row objects (identity-cached — see `rows`); this tells the
        // list to repaint visible rows when the selection set or the mode changes.
        extraData={listExtra}
        renderItem={renderItem}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {showAll && !chapters ? 'Loading chapters…' : 'Nothing downloaded for this series.'}
          </ThemedText>
        }
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop,
          paddingLeft: sidePad,
          paddingRight: sidePad,
          // Room for the floating pills, so the last rows can scroll clear of them.
          paddingBottom: selecting ? PILL_HEIGHT + Spacing.six : Spacing.three,
        }}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />

      {/* The floating select-mode chrome: staging "…" bottom-left, all valid verbs in ONE pill
          bottom-right (download tinted blue, cancel/delete danger). */}
      {selecting && (
        <SelectPillBar
          left={sidePad}
          right={sidePad}
          bottom={Math.max(insets.bottom, Spacing.three)}
          options={stagingRows}
          optionsTestID="series.dl.select-options"
          verbs={[
            ...(toPause.length > 0
              ? [{ key: 'pause', label: `Pause ${toPause.length} chapters`, Icon: PauseIcon, onPress: pauseSelected, testID: 'series.dl.pause' }]
              : []),
            ...(toResume.length > 0
              ? [{ key: 'resume', label: `Resume ${toResume.length} chapters`, Icon: PlayIcon, onPress: resumeSelected, testID: 'series.dl.resume' }]
              : []),
            ...(toCancel.length > 0
              ? [{ key: 'cancel', label: `Cancel ${toCancel.length} queued chapters`, Icon: ClearIcon, color: theme.danger, onPress: () => void cancelSelected(), testID: 'series.dl.cancel' }]
              : []),
            ...(toDelete.length > 0
              ? [{ key: 'delete', label: `Delete ${toDelete.length} chapters`, Icon: TrashIcon, color: theme.danger, onPress: confirmDeleteSelected, testID: 'series.dl.delete' }]
              : []),
            ...(toDownload.length > 0
              ? [{ key: 'download', label: `Download ${toDownload.length} chapters`, Icon: DownloadsIcon, color: theme.accent, onPress: downloadSelected, testID: 'series.dl.download' }]
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
  undownloaded: {
    width: 20,
    alignItems: 'center',
    opacity: 0.6,
  },
  // The settings-standard inset divider (see the Downloads page): absolute so rows stay exactly one
  // settings-row tall for the fixed-size list.
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: -SettingsGutter,
    height: StyleSheet.hairlineWidth,
  },
  empty: {
    paddingTop: Spacing.five,
    textAlign: 'center',
  },
});
