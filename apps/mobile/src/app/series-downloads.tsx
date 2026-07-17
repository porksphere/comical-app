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
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Holdable } from '@/components/context-menu';
import { openContextMenu } from '@/components/context-menu-host';
import { ANDROID_BLUR, MENU_FILL } from '@/components/context-menu-material';
import { DownloadStatusIndicator } from '@/components/downloads/download-status-indicator';
import { chapterActions } from '@/components/downloads/row-actions';
import {
  CheckIcon,
  ClearIcon,
  DownloadingIcon,
  DownloadsIcon,
  EyeIcon,
  PauseIcon,
  PlayIcon,
  SelectModeIcon,
  SelectOptionsIcon,
  TrashIcon,
} from '@/components/icons/ui-icons';
import { SelectCircle } from '@/components/multi-select/selectable-row';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
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
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import type { ChapterGroup } from '@/lib/chapter-order';
import type { DownloadedChapter, DownloadState } from '@comical/downloads';

/** How long the check circles take to slide in/out of the rows. */
const SELECT_ANIM_MS = 220;
/** The leading slot the circles occupy when open: circle + the row's gap. */
const CIRCLE_SLOT = 20 + Spacing.three;
/** The floating bulk-verb pills (select mode). A pill with ONE action renders as a full circle
 *  (width == height); more actions stretch it horizontally into a pill. */
const PILL_HEIGHT = 50;
const PILL_BLUR = 40;

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

/** The animated leading slot: the check circle SLIDES IN FROM THE SCREEN'S LEFT EDGE while the slot
 *  grows and pushes the row content right, fading up as it travels. The slot deliberately does NOT
 *  clip — clipped, the circle only ever appeared from the slot's own edge (at the hairline), not the
 *  screen's. `edgeOffset` is the slot's distance from the physical screen edge (the list's side
 *  padding), so the ride starts truly off-screen. One shared value drives every row — recycled views
 *  stay in sync. */
function SelectLead({
  progress,
  selected,
  edgeOffset,
}: {
  progress: SharedValue<number>;
  selected: boolean;
  edgeOffset: number;
}) {
  const slot = useAnimatedStyle(() => ({
    width: progress.value * CIRCLE_SLOT,
  }));
  const circle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (progress.value - 1) * (CIRCLE_SLOT + edgeOffset) }],
  }));
  return (
    <Animated.View style={[styles.selectLead, slot]}>
      <Animated.View style={circle}>
        <SelectCircle selected={selected} />
      </Animated.View>
    </Animated.View>
  );
}

export default function SeriesDownloadsScreen() {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
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

  // ── Multi-select mode ─────────────────────────────────────────────────────────
  const [selecting, setSelecting] = useState(params.select === '1');
  const selectProgress = useSharedValue(params.select === '1' ? 1 : 0);

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
    const next = !selecting;
    setSelecting(next);
    selectProgress.value = withTiming(next ? 1 : 0, { duration: SELECT_ANIM_MS });
    if (!next) ms.clear();
  };

  // ── Bulk verbs (the floating pills, select mode only) ─────────────────────────
  // Each verb surfaces only while the selection makes it valid:
  //  Download — not-yet-kept chapters (failed ones count: re-enqueueing retries).
  //  Pause / Resume — in-flight (downloading/queued) / paused chapters.
  //  Delete — anything downloaded/tracked.
  const picked = rows.filter((r) => ms.selected.has(r.key));
  const toDownload = picked.filter((r) => (r.group ? !r.c || r.c.state === 'failed' : r.c?.state === 'failed'));
  const toPause = picked.filter((r) => r.c && (r.c.state === 'downloading' || r.c.state === 'queued'));
  const toResume = picked.filter((r) => r.c?.state === 'paused');
  const toDelete = picked.filter((r) => r.c);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.seriesDownloads(bridgeId, seriesId) });
  };

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
    toggleSelecting();
  };

  // Pause/resume KEEP the selection (unlike download/delete): they only flip state, and the natural
  // follow-up ("pause these, now delete them") acts on the same chapters.
  const pauseSelected = () => {
    for (const r of toPause) void pauseChapter(r.c!.bridgeId, r.c!.seriesId, r.c!.chapterId);
  };
  const resumeSelected = () => {
    for (const r of toResume) void resumeChapterDownload(r.c!.bridgeId, r.c!.seriesId, r.c!.chapterId);
  };

  const deleteSelected = async () => {
    for (const r of toDelete) {
      const c = r.c!;
      await dlDeleteChapter(c.bridgeId, c.seriesId, c.chapterId).catch(() => {});
      forgetChapter(c.bridgeId, c.seriesId, c.chapterId);
    }
    invalidate();
    toggleSelecting();
  };

  // Full-width scroller centered within the settings column (same treatment as the Downloads page).
  const sidePad = SettingsGutter + Math.max(0, (width - MaxContentWidth) / 2);

  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;

  // The staging menu (top-left, replacing the back button in select mode): one circled-ellipsis
  // trigger opening the shared frosted context menu with the staging verbs.
  const openSelectOptions = (x: number, y: number) => {
    openContextMenu({
      x,
      y,
      rows: [
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
      ],
    });
  };

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
                <SelectLead progress={selectProgress} selected={ms.selected.has(item.key)} edgeOffset={sidePad} />
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
                    onDelete: () => void deleteChapterRow(item.c!),
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
      {/* Select mode takes over the whole bar: the staging menu replaces the back button, the
          live count replaces the title, and the toggle (accent while on) is the way out. */}
      <TopBar
        title={selecting ? `${ms.count} selected` : title}
        left={
          selecting ? (
            <Pressable
              testID="series.dl.select-options"
              onPress={(e) => openSelectOptions(e.nativeEvent.pageX, e.nativeEvent.pageY)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Selection options">
              <SelectOptionsIcon color={theme.text} size={24} />
            </Pressable>
          ) : undefined
        }
        right={
          <Pressable
            testID="series.dl.select-toggle"
            onPress={toggleSelecting}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={selecting ? 'Exit selection' : 'Select chapters'}>
            <SelectModeIcon color={selecting ? theme.accent : theme.text} size={24} />
          </Pressable>
        }
      />

      <LegendList
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
          paddingTop: topBarInset + Spacing.two,
          paddingLeft: sidePad,
          paddingRight: sidePad,
          // Room for the floating pills, so the last rows can scroll clear of them.
          paddingBottom: selecting ? PILL_HEIGHT + Spacing.six : Spacing.three,
        }}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />

      {/* The floating bulk verbs — each shown only while the selection makes it VALID: frosted
          icon pill(s) bottom-left, and the bigger accent Download pill bottom-right. */}
      {selecting && (toDelete.length > 0 || toDownload.length > 0 || toPause.length > 0 || toResume.length > 0) && (
        <View
          pointerEvents="box-none"
          style={[styles.pills, { left: sidePad, right: sidePad, bottom: Math.max(insets.bottom, Spacing.three) }]}>
          {toDelete.length > 0 || toPause.length > 0 || toResume.length > 0 ? (
            <View style={styles.pillShadow}>
              <BlurView tint={scheme} intensity={PILL_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={styles.actionsPill}>
                <View pointerEvents="none" style={[styles.pillFill, { backgroundColor: MENU_FILL[scheme] }]} />
                {toPause.length > 0 && (
                  <Pressable
                    testID="series.dl.pause"
                    onPress={pauseSelected}
                    style={styles.pillButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Pause ${toPause.length} chapters`}>
                    <PauseIcon color={theme.text} size={20} />
                  </Pressable>
                )}
                {toResume.length > 0 && (
                  <Pressable
                    testID="series.dl.resume"
                    onPress={resumeSelected}
                    style={styles.pillButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Resume ${toResume.length} chapters`}>
                    <PlayIcon color={theme.text} size={20} />
                  </Pressable>
                )}
                {toDelete.length > 0 && (
                  <Pressable
                    testID="series.dl.delete"
                    onPress={() => void deleteSelected()}
                    style={styles.pillButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${toDelete.length} chapters`}>
                    <TrashIcon color={theme.danger} size={20} />
                  </Pressable>
                )}
              </BlurView>
            </View>
          ) : (
            <View />
          )}
          {toDownload.length > 0 && (
            <View style={styles.pillShadow}>
              <BlurView tint={scheme} intensity={PILL_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={styles.downloadPill}>
                {/* Translucent accent over the blur — blue, but the page still bleeds through. */}
                <View pointerEvents="none" style={[styles.pillFill, { backgroundColor: `${theme.accent}D9` }]} />
                <Pressable
                  testID="series.dl.download"
                  onPress={downloadSelected}
                  style={styles.pillButtonWide}
                  accessibilityRole="button"
                  accessibilityLabel={`Download ${toDownload.length} chapters`}>
                  <DownloadsIcon color={theme.accentOn} size={22} />
                </Pressable>
              </BlurView>
            </View>
          )}
        </View>
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
  // The animated leading slot the circle slides into. NOT clipped — the circle rides in from the
  // physical screen edge, outside the slot's own bounds (its fade keeps it invisible at rest).
  selectLead: {
    justifyContent: 'center',
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
  // The floating bulk-verb layer: pills at the two bottom corners, taps pass through between them.
  pills: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  // Shadow lives on an unclipped wrapper — the BlurView inside must clip to its radius.
  pillShadow: {
    borderRadius: PILL_HEIGHT / 2,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  // The frosted secondary-actions surface (Delete today). Each icon button is exactly one
  // pill-height square, so ONE action renders as a full circle and additional icons stretch it
  // horizontally into a pill on their own — no per-count styling.
  actionsPill: {
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // The bigger accent circle: the one primary verb (same rule — it would stretch if it ever
  // carried a second action).
  downloadPill: {
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  pillButton: {
    width: PILL_HEIGHT,
    height: PILL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillButtonWide: {
    width: PILL_HEIGHT,
    height: PILL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
