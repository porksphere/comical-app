import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DownloadedChapter, DownloadState } from '@comical/downloads';

import { MenuActionRow, MenuHeader } from '@/components/context-menu';
import { ContextMenuHold, openContextMenu } from '@/components/context-menu-host';
import type { MenuRowSpec } from '@/components/context-menu-material';
import { DownloadStateVisual } from '@/components/downloads/download-status-indicator';
import { ArrowDownIcon, ArrowUpIcon, DownloadsIcon, TrashIcon } from '@/components/icons/ui-icons';
import { OptionList, useOverlay, type AnchorRect } from '@/components/overlay/overlay';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, MaxContentWidth, Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useLightCards } from '@/lib/perf-flags';
import { useTheme } from '@/hooks/use-theme';
import { dlDeleteChapter, dlGetSeries, resolveAssetSourceCached } from '@/data/api';
import { enqueueChapters } from '@/data/downloads/engine';
import { forgetChapter } from '@/data/downloads/index-cache';
import { fromHere, selectableGroups, toEnqueue } from '@/data/downloads/select';
import { queryClient } from '@/data/query-client';
import { coverDelayMs, relativeTime } from '@/data/mock';
import { hapticImpactMedium } from '@/lib/haptics';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { Chapter, PageThumbSource, SpriteThumb } from '@/data/types';
import { ASPECT_TRANSITION_MS, clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { groupChapters, pickVersion, type ChapterGroup } from '@/lib/chapter-order';
import { setPreferredGroup, usePreferredGroup } from '@/lib/preferred-group';
import { logDiagnostic } from '@/lib/diagnostics';
import { testId } from '@/lib/test-id';

// The series chapters block: tab filter (Overview / All / Read / Unread) + sort
// toggle (oldest/newest) over the chapter rows, with a "Show all" teaser on the
// Overview tab. For direct-series bridges, a page-thumbnail grid is rendered
// instead. Mirrors `#chapters-section` / `.page-thumb-grid` in the reference.

type Tab = 'overview' | 'all' | 'read' | 'unread';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'all', label: 'All' },
  { id: 'read', label: 'Read' },
  { id: 'unread', label: 'Unread' },
];
// The sort-direction toggle, in the same segmented-control chrome as TABS.
const SORT_OPTIONS: { id: 'desc' | 'asc'; label: string; Icon: typeof ArrowDownIcon }[] = [
  { id: 'desc', label: 'Newest first', Icon: ArrowDownIcon },
  { id: 'asc', label: 'Oldest first', Icon: ArrowUpIcon },
];
// Overview collapses long lists to a configurable number of chapters from the
// start and the end, with an expand button between them for the hidden middle.
const OVERVIEW_HEAD_COUNT = 5;
const OVERVIEW_TAIL_COUNT = 5;
// Track padding / gap between tab chips.
const TAB_PAD = 3;
const TAB_GAP = 4;
// Shared with the sort button so the whole controls row (tab strip + sort
// toggle) reads as one consistent height.
const CONTROLS_HEIGHT = 32;

export function ChaptersSection({
  chapters,
  loading,
  seed,
  title,
  bridgeId,
  offline,
}: {
  chapters?: Chapter[];
  /** The deferred chapter list is still fetching (see series.tsx + getSeriesList)
   *  — show a skeleton in this section's place. */
  loading?: boolean;
  /** Series identity, used to build reader navigation params. */
  seed: string;
  title: string;
  /** Originating bridge's stable id, carried to the reader for real API calls. */
  bridgeId?: string;
  /** The page is rendering from the offline metadata cache — chapters that aren't downloaded can't
   *  be read, so they dim and disable while downloaded ones stay fully readable. */
  offline?: boolean;
}) {
  // Direct-series page thumbnails are no longer rendered here — they're the
  // series screen's own virtualized scroller (see `PageThumbList`); this section
  // is just the chaptered-series list now.
  if (loading) return <ChapterListSkeleton />;
  return chapters?.length ? (
    <ChapterList chapters={chapters} seed={seed} title={title} bridgeId={bridgeId} offline={offline} />
  ) : null;
}

/** Chapter-list placeholder shown while the deferred chapter fetch is in flight
 *  (getSeriesList). Header + a few skeleton rows, so the section holds its place
 *  instead of popping in when the ~200ms /chapters request lands. */
function ChapterListSkeleton() {
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <ThemedText type="subtitle" style={styles.headTitle}>
          Chapters
        </ThemedText>
      </View>
      <View style={styles.skelRows}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} style={styles.skelChapterRow} />
        ))}
      </View>
    </View>
  );
}

/** Page-grid placeholder shown while the deferred page fetch is in flight — one
 *  row of tiles at the grid's column count, matching the thumbnail aspect. */
function PageGridSkeleton() {
  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 5 : width >= 600 ? 3 : 2;
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.headTitle}>
        Pages
      </ThemedText>
      <View style={styles.skelTileRow}>
        {Array.from({ length: cols }).map((_, i) => (
          <View key={i} style={styles.skelTile}>
            <Skeleton style={StyleSheet.absoluteFill} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** A row of mutually-exclusive options with a sliding highlight pill behind
 *  the active one — the chapter tab strip (Overview/All/Read/Unread) and the
 *  sort direction toggle are both one of these. Each option is sized to its
 *  own content (not an equal slice of the strip), so the pill's geometry has
 *  to be measured per-option via `onLayout` rather than computed from a
 *  shared segment width.
 *
 *  The pill animates via Reanimated's `layout` prop (`LinearTransition`)
 *  instead of a hand-rolled `useSharedValue`/`withTiming` pair driven from a
 *  `useEffect` — that JS-side approach could visibly snap the pill to the
 *  strip's left edge for a frame before sliding to the new tab (a stale
 *  `activeBox` briefly reading as unmeasured on some renders). `layout`
 *  hands the interpolation to the UI thread instead: it only animates a
 *  transition between two committed layouts of an already-mounted view, so
 *  there's no intermediate JS-computed frame to glitch through. On first
 *  mount there's nothing to transition from, so it just appears in place —
 *  no unwanted slide-in. */
function Segmented<T extends string>({
  options,
  active,
  onChange,
  itemStyle,
}: {
  options: { id: T; render: (active: boolean) => ReactNode; accessibilityLabel?: string; testID: string }[];
  active: T;
  onChange: (id: T) => void;
  itemStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [layouts, setLayouts] = useState<Partial<Record<T, { x: number; width: number }>>>({});
  const onOptLayout = (id: T, x: number, width: number) => {
    setLayouts((prev) => (prev[id]?.x === x && prev[id]?.width === width ? prev : { ...prev, [id]: { x, width } }));
  };
  const activeBox = layouts[active];
  return (
    <ThemedView type="backgroundElement" style={styles.tabs}>
      {activeBox && (
        <Animated.View
          pointerEvents="none"
          // A real spring (`.springify()`) only runs as physics on native — the
          // web fallback for layout animations (react-native-web) is a CSS
          // keyframe that ignores damping/stiffness/mass entirely and falls
          // back to a linear curve, so the "spring" was invisible on web. An
          // explicit overshoot bezier (the standard ease-out-back curve) gives
          // the same bounce-then-settle feel on both, since it's just a plain
          // easing curve rather than physics.
          layout={LinearTransition.duration(260).easing(Easing.bezier(0.34, 1.2, 0.64, 1))}
          style={[
            styles.tabPill,
            {
              backgroundColor: theme.accent,
              left: activeBox.x,
              width: activeBox.width,
            },
          ]}
        />
      )}
      {options.map((opt) => (
        <SegmentButton
          key={opt.id}
          testID={opt.testID}
          active={opt.id === active}
          itemStyle={itemStyle}
          accessibilityLabel={opt.accessibilityLabel}
          onPress={() => onChange(opt.id)}
          onLayout={(x, width) => onOptLayout(opt.id, x, width)}>
          {opt.render(opt.id === active)}
        </SegmentButton>
      ))}
    </ThemedView>
  );
}

/** One `Segmented` option button. Its own component (rather than a raw
 *  `Pressable` inside `options.map`) so each option gets its own `useHovered`
 *  call — same reasoning as chip.tsx's `PressableChip`. */
function SegmentButton({
  active,
  itemStyle,
  accessibilityLabel,
  testID,
  onPress,
  onLayout,
  children,
}: {
  active: boolean;
  itemStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID: string;
  onPress: () => void;
  onLayout: (x: number, width: number) => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      onLayout={(e) => onLayout(e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        itemStyle ?? styles.tab,
        // Brighten (not dim) on hover — never on the already-highlighted
        // active option, which already reads as selected via the pill.
        hovered && !active && { backgroundColor: theme.backgroundSelected },
      ]}>
      {children}
    </Pressable>
  );
}

/** One expanded scanlator/language version row under a chapter. Its own
 *  component (rather than raw `Pressable` inside `group.versions.map`) so
 *  each row gets its own `useHovered` call. */
function VersionRow({ v, active, onPress }: { v: Chapter; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testId('series.chapter.version', v.id)}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      style={({ pressed }) => [
        styles.versionRow,
        pressed && styles.rowPressed,
        hovered && { backgroundColor: theme.backgroundSelected },
      ]}>
      <ThemedText
        type="small"
        numberOfLines={1}
        style={[
          styles.versionLabel,
          v.read && { color: theme.textSecondary },
          // Highlight the copy the main row currently opens.
          active && { color: theme.accent, fontWeight: '600' },
        ]}>
        {versionLabel(v)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.rowTime}>
        {relativeTime(v.date)}
      </ThemedText>
    </Pressable>
  );
}

function ChapterList({
  chapters,
  seed,
  title,
  bridgeId,
  offline,
}: {
  chapters: Chapter[];
  seed: string;
  title: string;
  bridgeId?: string;
  offline?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [asc, setAsc] = useState(false);
  // Overview-only: reveal the collapsed middle portion inline.
  const [middleExpanded, setMiddleExpanded] = useState(false);
  const expandMiddleHover = useHovered();

  // Per-chapter download state for the trailing indicators. Same query key the series Download
  // button subscribes to, so it's already fetched on this page AND live-patched page-by-page by the
  // download events pipe — a downloading chapter's radial advances in place.
  const { data: dl } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId ?? '', seed),
    queryFn: () => dlGetSeries(bridgeId ?? '', seed).catch(() => null),
    enabled: !!bridgeId,
  });
  const dlByChapter = useMemo(
    () => new Map((dl?.chapters ?? []).map((c) => [c.chapterId, c])),
    [dl],
  );

  // The scanlation group the user last opened — controls which version each logical
  // chapter defaults to, so the list keeps showing the source they're reading.
  const preferredGroup = usePreferredGroup();

  // Collapse multi-scanlator copies into logical chapters and order them by number
  // (see @/lib/chapter-order). `groupChapters` returns ascending reading order; the
  // default view is newest-first, so reverse unless the ascending toggle is on. A
  // group counts as read only when every one of its versions is read.
  const groups = useMemo(() => {
    let list = groupChapters(chapters);
    if (tab === 'read') list = list.filter((g) => g.versions.every((v) => v.read));
    else if (tab === 'unread') list = list.filter((g) => g.versions.some((v) => !v.read));
    return asc ? list : [...list].reverse();
  }, [chapters, tab, asc]);

  // Open a specific version: remember its group as the preferred source, then route
  // to the reader for that copy.
  const openVersion = (v: Chapter) => {
    setPreferredGroup(v.group);
    router.push({
      pathname: '/reader',
      params: {
        seed,
        title,
        chapterId: v.id,
        chapterName: v.name,
        start: '0',
        ...(bridgeId ? { bridgeId } : {}),
      },
    });
  };

  // Overview shows the first HEAD + last TAIL chapters, with the middle behind an
  // expand button. Only collapse when it hides ≥2 chapters (a button that hides a
  // single row isn't worth the space). Other tabs show their full filtered list.
  const collapsible =
    tab === 'overview' &&
    !middleExpanded &&
    groups.length > OVERVIEW_HEAD_COUNT + OVERVIEW_TAIL_COUNT + 1;
  const hiddenCount = collapsible ? groups.length - OVERVIEW_HEAD_COUNT - OVERVIEW_TAIL_COUNT : 0;
  const head = collapsible ? groups.slice(0, OVERVIEW_HEAD_COUNT) : groups;
  const tail = collapsible ? groups.slice(groups.length - OVERVIEW_TAIL_COUNT) : [];

  // Long-press a row → the per-chapter download menu. NATIVE: the generic hold-menu host — the
  // series card popup's menu system (frosted point-anchored menu, peek-and-commit, open thump),
  // generalized in context-menu-host.tsx. WEB: the overlay popover with the shared MenuActionRow
  // chrome, matching how web series cards use the overlay for their 3-dot menu.
  const { open } = useOverlay();
  const manifest = useMemo(() => dl?.chapters ?? [], [dl]);
  const openChapterMenu = (g: ChapterGroup, anchor?: AnchorRect) => {
    if (!bridgeId) return;
    if (Platform.OS !== 'web' && anchor) {
      openContextMenu({
        // No title line — the pressed row is right there naming the chapter; rows only, like the
        // series popup's own menu.
        x: anchor.x,
        y: anchor.y,
        rows: chapterMenuRows({
          bridgeId,
          seriesId: seed,
          title,
          chapters,
          manifest,
          group: g,
          preferredGroup,
        }),
      });
      return;
    }
    hapticImpactMedium();
    open(
      () => (
        <ChapterDownloadMenu
          bridgeId={bridgeId}
          seriesId={seed}
          title={title}
          chapters={chapters}
          manifest={manifest}
          group={g}
          preferredGroup={preferredGroup}
        />
      ),
      anchor ?? null,
      { popover: !!anchor },
    );
  };

  const row = (g: ChapterGroup) => {
    const dlState = groupDownloadState(g, dlByChapter);
    return (
      <ChapterRow
        key={g.key}
        group={g}
        preferredGroup={preferredGroup}
        onOpen={openVersion}
        onMenu={bridgeId ? openChapterMenu : undefined}
        dlState={dlState}
        // Offline, only a fully-downloaded chapter is readable — the rest dim and disable.
        dimmed={offline === true && dlState?.state !== 'complete'}
      />
    );
  };

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <ThemedText type="subtitle" style={styles.headTitle}>
          Chapters
        </ThemedText>
        <View style={styles.controls}>
          <Segmented
            options={TABS.map((t) => ({
              id: t.id,
              accessibilityLabel: t.label,
              testID: testId('series.chapters.tab', t.id),
              render: (active) => (
                <ThemedText
                  type="small"
                  numberOfLines={1}
                  style={[styles.tabLabel, active ? { color: theme.accentOn } : { color: theme.textSecondary }]}>
                  {t.label}
                </ThemedText>
              ),
            }))}
            active={tab}
            onChange={(id) => {
              setTab(id);
              setMiddleExpanded(false);
            }}
          />
          <Segmented
            options={SORT_OPTIONS.map((s) => ({
              id: s.id,
              accessibilityLabel: s.label,
              testID: testId('series.chapters.sort', s.id),
              render: (active) => (
                <s.Icon color={active ? theme.accentOn : theme.textSecondary} size={16} />
              ),
            }))}
            active={asc ? 'asc' : 'desc'}
            onChange={(id) => setAsc(id === 'asc')}
            itemStyle={styles.sortTab}
          />
        </View>
      </View>

      <View style={styles.list}>
        {head.map(row)}

        {collapsible && (
          <Pressable
            testID="series.chapters.expand-middle"
            onPress={() => setMiddleExpanded(true)}
            onHoverIn={expandMiddleHover.onHoverIn}
            onHoverOut={expandMiddleHover.onHoverOut}
            style={[
              styles.expandMiddle,
              // Brighten (not dim) on hover — same treatment as the chapter tab strip.
              expandMiddleHover.hovered && { backgroundColor: theme.backgroundSelected, borderRadius: 8 },
            ]}>
            <ThemedText type="small" style={[styles.expandMiddleText, { color: theme.accent }]}>
              Show {hiddenCount} more chapters
            </ThemedText>
          </Pressable>
        )}

        {tail.map(row)}

        {groups.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No chapters here.
          </ThemedText>
        )}
      </View>
    </View>
  );
}

/**
 * The download state a logical chapter row shows: the BEST state across its scanlator/language
 * versions (any complete copy means the chapter is readable offline), with the in-flight fraction
 * for a downloading one. Null when no version has any download record — clean rows stay clean.
 */
function groupDownloadState(
  g: ChapterGroup,
  byId: Map<string, DownloadedChapter>,
): { state: DownloadState; fraction: number } | null {
  const rank: Record<DownloadState, number> = { complete: 4, downloading: 3, queued: 2, paused: 1, failed: 0 };
  let best: DownloadedChapter | undefined;
  for (const v of g.versions) {
    const d = byId.get(v.id);
    if (d && (!best || rank[d.state] > rank[best.state])) best = d;
  }
  if (!best) return null;
  return { state: best.state, fraction: best.pageCount > 0 ? best.completedPages / best.pageCount : 0 };
}

/** A short label for one scanlator/language version of a chapter, e.g.
 *  "MangaDweebs · EN · 18p". Falls back to the display name if it carries no
 *  group/language/page metadata. */
function versionLabel(v: Chapter): string {
  return (
    [v.group, v.languageCode?.toUpperCase(), v.pageCount ? `${v.pageCount}p` : null]
      .filter(Boolean)
      .join(' · ') || v.name
  );
}

/** One logical-chapter row. When the chapter has more than one scanlator/language
 *  version it shows an "N versions ▾" toggle that expands the per-version list; the
 *  main row opens the default version (the preferred group's copy, else the freshest),
 *  and each expanded row opens that specific version. */
function ChapterRow({
  group,
  preferredGroup,
  onOpen,
  onMenu,
  dlState,
  dimmed,
}: {
  group: ChapterGroup;
  preferredGroup?: string;
  onOpen: (v: Chapter) => void;
  /** Long-press: the per-chapter download menu (download this / from here / delete). */
  onMenu?: (group: ChapterGroup, anchor?: AnchorRect) => void;
  /** Download indicator for this logical chapter (best state across versions), if any. */
  dlState?: { state: DownloadState; fraction: number } | null;
  /** Rendering offline and not downloaded — unreadable, so the row dims and its press disables. */
  dimmed?: boolean;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const rowHover = useHovered();
  const versionsHover = useHovered();
  const def = pickVersion(group, preferredGroup);
  // A logical chapter reads as "read" only once every version of it is read.
  const read = group.versions.every((v) => v.read);
  const multi = group.versions.length > 1;

  return (
    <ContextMenuHold
      enabled={!!onMenu && !dimmed}
      onOpen={(pt) => onMenu?.(group, { x: pt.x, y: pt.y, width: 0, height: 0 })}>
      {({ onLongPress }) => (
    <View style={dimmed && styles.rowDimmed}>
      <Pressable
        testID={testId('series.chapter', group.key)}
        onPress={() => onOpen(def)}
        onLongPress={onLongPress}
        disabled={dimmed}
        onHoverIn={rowHover.onHoverIn}
        onHoverOut={rowHover.onHoverOut}
        style={({ pressed }) => pressed && styles.rowPressed}>
        <ThemedView
          type="backgroundElement"
          style={[
            styles.row,
            { borderColor: theme.hairline },
            // Brighten (not dim) on hover — same treatment as the chapter tab strip.
            rowHover.hovered && { backgroundColor: theme.backgroundSelected },
          ]}>
          <ThemedText
            type="small"
            numberOfLines={1}
            style={[styles.rowName, read && { color: theme.textSecondary }]}>
            {group.name}
          </ThemedText>
          {dlState && (
            <View style={styles.rowDownload} testID={testId('series.chapter', group.key, 'download-state')}>
              <DownloadStateVisual state={dlState.state} fraction={dlState.fraction} size={14} strokeWidth={2} />
            </View>
          )}
          {multi && (
            <Pressable
              testID={testId('series.chapter', group.key, 'versions')}
              onPress={() => setExpanded((v) => !v)}
              onHoverIn={versionsHover.onHoverIn}
              onHoverOut={versionsHover.onHoverOut}
              hitSlop={6}
              style={[
                styles.versionsBtn,
                versionsHover.hovered && { backgroundColor: theme.backgroundSelected, borderRadius: 6 },
              ]}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                {group.versions.length} versions {expanded ? '▴' : '▾'}
              </ThemedText>
            </Pressable>
          )}
          <ThemedText type="small" themeColor="textSecondary" style={styles.rowTime}>
            {relativeTime(def.date)}
          </ThemedText>
        </ThemedView>
      </Pressable>
      {multi && expanded && (
        <View style={styles.versionList}>
          {group.versions.map((v) => (
            <VersionRow key={v.id} v={v} active={v.id === def.id} onPress={() => onOpen(v)} />
          ))}
        </View>
      )}
    </View>
      )}
    </ContextMenuHold>
  );
}

/** The chapter menu's actions + coverage, computed once and shared by both presentations (the
 *  native hold menu's rows and the web overlay's). */
function chapterMenuActions(args: {
  bridgeId: string;
  seriesId: string;
  title: string;
  chapters: Chapter[];
  manifest: DownloadedChapter[];
  group: ChapterGroup;
  preferredGroup?: string;
}) {
  const { bridgeId, seriesId, title, chapters, manifest, group, preferredGroup } = args;
  const sel = selectableGroups(chapters, manifest);
  const entry = sel.find((s) => s.group.key === group.key);
  const span = fromHere(sel, pickVersion(group, preferredGroup).id);
  const snap = { bridgeId, seriesId, title };
  const completeIds = new Set(manifest.filter((c) => c.state === 'complete').map((c) => c.chapterId));
  const downloadedVersions = group.versions.filter((v) => completeIds.has(v.id));
  return {
    entry,
    span,
    downloadedVersions,
    downloadThis: () => enqueueChapters(snap, toEnqueue([group], preferredGroup)),
    downloadFromHere: () => enqueueChapters(snap, toEnqueue(span, preferredGroup)),
    deleteDownload: async () => {
      for (const v of downloadedVersions) {
        await dlDeleteChapter(bridgeId, seriesId, v.id).catch(() => {});
        forgetChapter(bridgeId, seriesId, v.id);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.seriesDownloads(bridgeId, seriesId) });
    },
  };
}

/** The NATIVE hold menu's rows (`MenuRowSpec` — the series-popup menu system's row shape). Counts
 *  ride in the labels; per the shared menu's rule, nothing is coloured. */
function chapterMenuRows(args: Parameters<typeof chapterMenuActions>[0]): MenuRowSpec[] {
  const { entry, span, downloadedVersions, downloadThis, downloadFromHere, deleteDownload } = chapterMenuActions(args);
  const rows: MenuRowSpec[] = [
    {
      label: entry?.settled ? 'Already saved' : 'Download chapter',
      Icon: DownloadsIcon,
      loading: false,
      disabled: !entry || entry.settled,
      testID: testId('series.chapter-menu', 'this'),
      onPress: downloadThis,
    },
    {
      label: span.length > 0 ? `Download from here (${span.length})` : 'Download from here',
      Icon: ArrowDownIcon,
      loading: false,
      disabled: span.length === 0,
      testID: testId('series.chapter-menu', 'from-here'),
      onPress: downloadFromHere,
    },
  ];
  if (downloadedVersions.length > 0) {
    rows.push({
      label: 'Delete download',
      Icon: TrashIcon,
      loading: false,
      testID: testId('series.chapter-menu', 'delete'),
      onPress: () => void deleteDownload(),
    });
  }
  return rows;
}

/**
 * The long-press chapter menu: quick per-chapter download actions without leaving the list.
 * "Download from here" is the one-gesture range answer (this chapter through the end of reading
 * order, skipping anything already kept/queued); a fully-downloaded chapter offers Delete too.
 * Rendered with the shared context-menu chrome (`MenuHeader` + `MenuActionRow`), so it reads as the
 * same kind of object as the series card's long-press menu. WEB ONLY — native uses the hold-menu
 * host (see `openChapterMenu`).
 */
function ChapterDownloadMenu({
  bridgeId,
  seriesId,
  title,
  chapters,
  manifest,
  group,
  preferredGroup,
}: {
  bridgeId: string;
  seriesId: string;
  title: string;
  chapters: Chapter[];
  manifest: DownloadedChapter[];
  group: ChapterGroup;
  preferredGroup?: string;
}) {
  const { closeTop } = useOverlay();
  const { entry, span, downloadedVersions, downloadThis, downloadFromHere, deleteDownload } = chapterMenuActions({
    bridgeId,
    seriesId,
    title,
    chapters,
    manifest,
    group,
    ...(preferredGroup !== undefined && { preferredGroup }),
  });

  return (
    <View style={styles.menuBody}>
      <MenuHeader title={group.name} textOnly />
      <OptionList>
        <MenuActionRow
          testID={testId('series.chapter-menu', 'this')}
          label="Download this chapter"
          Icon={DownloadsIcon}
          disabled={!entry || entry.settled}
          detail={entry?.settled ? 'already saved' : '1 chapter'}
          onPress={() => {
            downloadThis();
            closeTop();
          }}
        />
        <MenuActionRow
          testID={testId('series.chapter-menu', 'from-here')}
          label="Download from here"
          Icon={ArrowDownIcon}
          disabled={span.length === 0}
          detail={span.length === 1 ? '1 chapter' : `${span.length} chapters`}
          onPress={() => {
            downloadFromHere();
            closeTop();
          }}
        />
        {downloadedVersions.length > 0 && (
          <MenuActionRow
            testID={testId('series.chapter-menu', 'delete')}
            label="Delete download"
            Icon={TrashIcon}
            detail="free the space"
            onPress={() => {
              void deleteDownload();
              closeTop();
            }}
          />
        )}
      </OptionList>
    </View>
  );
}

// Rows of tiles shown before a long page set collapses behind "Show all".
const COLLAPSED_ROWS = 4;

/**
 * One grid cell fed to the `LegendList`. A discriminated, always-non-null value on purpose:
 * `@legendapp/list` treats a bare `null` entry in `data` as the end of the list and stops
 * virtualizing past it (both its web and native builds share this core), which capped the grid
 * at the first lazily-fetched page. So a page whose thumbnail isn't inlined yet is still a real
 * `page` cell carrying a `null` thumb — the absence lives *inside* the descriptor, not as the
 * cell itself.
 *
 * Every cell is a real page. There used to be a `spacer` variant padding out a short last row, which
 * a `flex: 1` cell needed or it would stretch its tiles across the row — the cell is pinned to
 * `tileW` now, so a short row simply ends. Given the null-entry footgun above, putting synthetic
 * entries in this particular `data` array was a fight not worth having.
 */
type PageCell = { kind: 'page'; pageIndex: number; thumb: PageThumbSource | null };

/**
 * The direct-series page-thumbnail grid — and the series screen's own scroll
 * container: a virtualized, recycling `LegendList`, so an expanded 1000-page set
 * keeps only a bounded window of tiles mounted instead of every tile the old
 * plain-`.map` grid accumulated. A vertical virtualized list can't be nested in
 * the series screen's old `ScrollView`, so it IS the scroller now — the hero/meta
 * is the list `header` and the related rails are the `footer`, threaded in from
 * `series.tsx`.
 *
 * The collapse is kept (it isn't only about perf): a long grid otherwise pushes
 * the related rails far out of reach, so by default we show the first few rows
 * with a "Show all N pages" button and the rails right below it; tapping it
 * expands to the full (now virtualized) grid. The old batch-streaming sentinel is
 * gone — virtualization is what makes the expanded set cheap.
 */
export function PageThumbList({
  thumbs,
  loading,
  seed,
  title,
  bridgeId,
  header,
  footer,
  topInset = 0,
}: {
  thumbs: (PageThumbSource | null)[];
  /** The deferred page list is still fetching — show a skeleton in the header. */
  loading?: boolean;
  seed: string;
  title: string;
  bridgeId?: string;
  /** Series hero/meta — the list header (this component owns the scroller). */
  header?: ReactElement | null;
  /** Height of an overlaying top bar, so the first row clears it (and scrolls under its frost). */
  topInset?: number;
  /** Related-series rails — the list footer, below the grid and the "Show all"
   *  button (while collapsed). */
  footer?: ReactElement | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const showMoreHover = useHovered();

  const cols = screenW >= 900 ? 5 : screenW >= 600 ? 3 : 2;
  const gap = Spacing.two;
  // Cap + centre the content at MaxContentWidth (matching the chaptered layout),
  // inset by Spacing.four; the tiles fill the resulting columns.
  const sidePad = Math.max(0, (screenW - MaxContentWidth) / 2) + Spacing.four;
  const contentWidth = Math.min(screenW, MaxContentWidth) - Spacing.four * 2;
  const tileW = (contentWidth - gap * (cols - 1)) / cols;
  // Row height: the constant 2:3 slot (`thumbShell`). It must be the vertical MAX a tile can take —
  // clampThumbAspect floors every tile there — so a taller tile can never overflow its row. A tile
  // wider than 2:3 is SHORTER than its slot and top-aligns in it, keeping its own shape; that space
  // below it is by design, not the grey strip (which was the crop, see SpriteCrop).
  const slotHeightPx = tileW / DEFAULT_THUMB_ASPECT;
  // The collapsed fade height mirrors the reference's `.page-thumbs-more`: ~0.6 of
  // a tile's height, so the last row reads as fading out under the button.
  const fadeHeight = Math.round(slotHeightPx * 0.6);

  const collapsedCount = cols * COLLAPSED_ROWS;
  // Only collapse behind "Show all" when there's a footer (related rails, or
  // its loading skeleton) worth keeping reachable — that's the entire reason
  // this gate exists. A series with nothing below the grid has nothing to
  // protect, so just render the full (already-virtualized) list directly.
  const collapsed = !expanded && !!footer && thumbs.length > collapsedCount;
  // Collapsed shows the first few rows (so the rails stay reachable); expanded shows all,
  // virtualized. Empty while loading (the header shows the page skeleton instead).
  const base = loading ? [] : collapsed ? thumbs.slice(0, collapsedCount) : thumbs;
  const data = useMemo<PageCell[]>(
    // `base` is sliced from index 0 (collapsed or not), so its position IS the page index.
    () => base.map((thumb, pageIndex) => ({ kind: 'page', pageIndex, thumb })),
    [base],
  );

  return (
    <LegendList
      style={styles.pageList}
      data={data}
      keyExtractor={(_, i) => String(i)}
      numColumns={cols}
      recycleItems
      // Every cell's real height is this, exactly, regardless of content — the slot never resizes
      // once mounted (`thumbShell` is a constant 2:3 slot), so unlike a
      // normal dynamic-height list this doesn't need to be *learned* via onLayout. Declaring it
      // via getFixedItemSize (not just estimatedItemSize, which is only ever a pre-measurement
      // guess) tells LegendList every row's exact position upfront, so it can jump straight to
      // any scroll offset — e.g. dragging a scrollbar or `scrollToEnd` to the last row of a long
      // page grid — without needing to render (and thus mount/fetch) every row above it first
      // just to measure its way there. Excludes `gap` here since the library adds its own
      // `ctx.scrollAxisGap` (derived from columnWrapperStyle.gap below) on top automatically.
      getFixedItemSize={() => slotHeightPx}
      estimatedItemSize={slotHeightPx + gap}
      columnWrapperStyle={{ gap }}
      contentContainerStyle={{
        paddingTop: BarContentGap + topInset,
        paddingBottom: insets.bottom + Spacing.five,
        paddingLeft: sidePad,
        paddingRight: sidePad,
      }}
      ListHeaderComponent={
        <View style={styles.pageHeader}>
          {header}
          {loading ? (
            <PageGridSkeleton />
          ) : (
            // marginBottom reinstates the title→grid gap the old `section` gap gave
            // (the list's items start immediately after this header otherwise).
            <ThemedText type="subtitle" style={[styles.headTitle, styles.pagesHeading]}>
              Pages
            </ThemedText>
          )}
        </View>
      }
      ListFooterComponent={
        <View style={styles.pageFooter}>
          {collapsed && (
            // Overlaps the last visible row (negative top margin) with a gradient
            // that fades it out under the centered "Show all" button — the old
            // `.page-thumbs-more` overlay, reproduced in the list footer.
            <View style={[styles.moreOverlay, { height: fadeHeight, marginTop: -fadeHeight, pointerEvents: 'box-none' }]}>
              <GradientFade color={theme.background} />
              <Pressable
                testID="series.pages.show-all"
                onPress={() => setExpanded(true)}
                onHoverIn={showMoreHover.onHoverIn}
                onHoverOut={showMoreHover.onHoverOut}
                hitSlop={8}>
                <ThemedView
                  type="backgroundElement"
                  style={[
                    styles.showMore,
                    { borderColor: theme.hairline },
                    // Brighten (not dim) on hover — same treatment as the chapter tab strip.
                    showMoreHover.hovered && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    Show all {thumbs.length} pages
                  </ThemedText>
                </ThemedView>
              </Pressable>
            </View>
          )}
          {/* Rails are full-bleed to the capped column — cancel the Spacing.four inset. */}
          {footer ? <View style={styles.pageFooterRails}>{footer}</View> : null}
        </View>
      }
      renderItem={({ item }) => (
        // Pinned to `tileW` — the same width the tile inside it is drawn at. An elastic cell is what
        // made a short final row stretch, which is why this grid used to pad `data` with spacers.
        <View style={[styles.pageCell, { width: tileW }]}>
          <PageThumb
            thumb={item.thumb}
            index={item.pageIndex}
            seed={seed}
            bridgeId={bridgeId}
            page={item.pageIndex + 1}
            width={tileW}
            onPress={() =>
              router.push({
                pathname: '/reader',
                params: { seed, title, direct: '1', start: String(item.pageIndex), ...(bridgeId ? { bridgeId } : {}) },
              })
            }
          />
        </View>
      )}
    />
  );
}

// Cross-instance cache of page thumbnails that have already resolved at least once this
// session — same rationale and lifetime as SeriesCard's `resolvedCoverIds`/`resolvedCoverAspects`:
// the page grid recycles tile instances, so without this a revisit (e.g. scrolling back up over
// already-seen pages) replayed the whole skeleton/simulated-delay sequence for a thumbnail that's
// already sitting in expo-image's own memory-disk cache. Keyed by the same URL used for the
// simulated-latency hash (`delayKey` below), not `index`, since that's the thumbnail's actual
// content identity — `index` is just this page's position, which a recycled instance reuses for
// a different page entirely.
const resolvedThumbIds = new Set<string>();
const resolvedThumbAspects = new Map<string, number>();

// Rolling "last resolved" aspect ratio for page thumbnails — same rationale as SeriesCard's
// `lastResolvedCoverAspect` (page thumbnails within a chapter are typically all the same
// shape), kept as a separate scalar since page thumbs and series covers don't share a
// distribution. Used as the initial/recycle seed below instead of the flat placeholder.
let lastResolvedThumbAspect = DEFAULT_THUMB_ASPECT;

function thumbDelayKey(t: PageThumbSource | null): string {
  return t ? (t.kind === 'sprite' ? t.sheetUrl : t.url) : '';
}

/**
 * The FLIP-style aspect "shrink" illusion for a page tile — the same technique (and the same
 * rationale) as SeriesCard's CoverShrink, in its own component so its reanimated hooks are only
 * ALLOCATED when they're used. PageThumb mounts it only when the Lightweight cards lever is off; when
 * on, it renders the body with a no-op API, so a scrolling page grid pays nothing for the machinery.
 *
 * Animating `aspectRatio` (a layout prop) would relayout every frame; instead the box's aspect is
 * committed instantly and this transform-only style fakes the settle: the picture layer scales down
 * from its old apparent size to its real one. No trailing-group equivalent is needed here — the tile
 * top-aligns in a constant slot and `pageNum` sits outside the scaled layer, so nothing else shifts.
 */
type ThumbShrinkApi = {
  pictureStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Kick off the settle from the old aspect to the new one (called from the picture's onLoad). */
  runShrink?: (oldAspect: number, newAspect: number, boxWidth: number) => void;
};

const NOOP_THUMB_SHRINK: ThumbShrinkApi = {};

function ThumbShrink({ index, children }: { index: number; children: (api: ThumbShrinkApi) => ReactNode }) {
  const progressSV = useSharedValue(1); // 1 = settled; animates 0 -> 1 per transition
  const fromScaleSV = useSharedValue(1); // picture's scaleY at progress 0

  // Reset to rest when this instance is recycled to a different page (an effect, not render — writing
  // a shared value during render trips reanimated's strict-mode warning on every recycle).
  useEffect(() => {
    progressSV.set(1);
    fromScaleSV.set(1);
  }, [index, progressSV, fromScaleSV]);

  const pictureStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: fromScaleSV.value + (1 - fromScaleSV.value) * progressSV.value }],
  }));

  const runShrink = useCallback(
    (oldAspect: number, newAspect: number, boxWidth: number) => {
      // Only animate a real shape change, and only once the box's pixel width is known (from onLayout).
      if (!(boxWidth > 0) || oldAspect === newAspect) return;
      const oldHeight = boxWidth / oldAspect;
      const newHeight = boxWidth / newAspect;
      fromScaleSV.set(newHeight > 0 ? oldHeight / newHeight : 1);
      progressSV.set(0);
      progressSV.set(withTiming(1, { duration: ASPECT_TRANSITION_MS, easing: Easing.out(Easing.cubic) }));
    },
    [fromScaleSV, progressSV],
  );

  return <>{children({ pictureStyle, runShrink })}</>;
}

/** A single page tile: holds the image behind a simulated network delay and
 *  shows a shimmer skeleton until it's both elapsed and loaded — same treatment
 *  as the cover images, so a long page set visibly streams in. A `null` thumb
 *  (the bridge didn't supply this page's thumbnail inline) is fetched lazily
 *  on mount, mirroring comical-web's `loadLazyThumbs` — the tile never falls
 *  back to the full-size page image, it just stays a skeleton if that fails.
 *  A `sprite` thumb renders via `SpriteCrop` instead of a plain `Image`; a
 *  sprite tile also takes its own aspect ratio (`w`/`h`) rather than the
 *  uniform 2:3 default, since sprite sheets often pack mixed page shapes. */
export function PageThumb({
  thumb,
  index,
  seed,
  bridgeId,
  page,
  width,
  onPress,
  showPageNumber = true,
  slotHeight,
}: {
  thumb: PageThumbSource | null;
  index: number;
  seed: string;
  bridgeId?: string;
  page: number;
  width: number;
  onPress?: () => void;
  /** The page-number badge — on for the series page grid, off for the compact card-preview rail. */
  showPageNumber?: boolean;
  /** When set, the tile fills this fixed height and its WIDTH follows the page's real aspect ratio
   *  (variable-width, for the card-preview rail) instead of the grid's default width-driven, constant
   *  2:3 slot. `width` is then ignored for layout — the sprite crop scales to `slotHeight * aspect`. */
  slotHeight?: number;
}) {
  const ds = useDataSource();
  const mock = useMockActive();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const [resolved, setResolved] = useState(thumb);
  const [loaded, setLoaded] = useState(() => resolvedThumbIds.has(thumbDelayKey(thumb)));
  // Real aspect of a plain `image` tile, learned from its own onLoad (see the
  // note on the derivation below) rather than an off-screen prefetch. A plain,
  // UNanimated value — like SeriesCard's `coverAspect`, this only ever shrinks
  // from the default (never grows past it), so setting it is always a single,
  // one-time relayout of `thumbBox`. The *visual* shrink is smoothed separately
  // by `picturePageStyle` (pure `transform`, no further relayout) below. Seeded
  // from `resolvedThumbAspects` when this thumbnail has already resolved before,
  // else from the rolling `lastResolvedThumbAspect` guess rather than the flat
  // placeholder (page thumbs in a chapter tend to share a shape).
  const [imageAspect, setImageAspect] = useState(
    () => resolvedThumbAspects.get(thumbDelayKey(thumb)) ?? lastResolvedThumbAspect,
  );
  // Lightweight cards: the same Settings lever SeriesCard honours (see lib/perf-flags). When on, the
  // tile pays for NO animation machinery at all — the shrink's reanimated hooks aren't even allocated
  // (they live in ThumbShrink, mounted only when the lever is off), the image cross-fade is dropped,
  // and the skeleton (plus the `loaded` state flip that only exists to hide it) goes with them. A
  // page grid mounts far more of these than a browse grid mounts cards, so it's the same argument.
  const lightCards = useLightCards();
  // The tile box's REAL laid-out size — what the sprite crop must be scaled by (see boxWidth/
  // boxHeight). Null until the first layout, when the `width` estimate stands in.
  const [boxSize, setBoxSize] = useState<{ w: number; h: number } | null>(null);

  // Recycle-safety: the page grid uses recycleItems, so this instance is reused
  // for a different page as the list scrolls. Reset per-tile state synchronously
  // when the page index changes (React's "adjust state on prop change" pattern,
  // same as SeriesCard) so a reused tile doesn't briefly show the previous
  // page's thumbnail/aspect. No-op on a fresh mount.
  const prevIndexRef = useRef(index);
  if (prevIndexRef.current !== index) {
    prevIndexRef.current = index;
    setResolved(thumb);
    const key = thumbDelayKey(thumb);
    setLoaded(resolvedThumbIds.has(key));
    setImageAspect(resolvedThumbAspects.get(key) ?? lastResolvedThumbAspect);
  }

  // Lazy per-page thumbnail (only the pages a bridge didn't inline, i.e. `thumb === null`). Via
  // react-query so scrolling back to an already-fetched page is instant (cached, in-memory only —
  // see NO_PERSIST_KEYS) and identical tiles dedupe. `getPageThumb` never rejects — it maps errors
  // to `null` and logs its own diagnostic in source.ts — so a failure just leaves the tile a
  // skeleton, same as before.
  const thumbQuery = useQuery({
    queryKey: queryKeys.pageThumb(mock, bridgeId ?? '', seed, index),
    queryFn: ({ signal }) => ds.getPageThumb(bridgeId!, seed, index, signal),
    enabled: !!bridgeId && !thumb,
  });
  useEffect(() => {
    if (thumbQuery.data) setResolved(thumbQuery.data);
  }, [thumbQuery.data]);

  // A stable key for the simulated-latency hash: the sheet URL for a sprite tile (every tile cut
  // from the same sheet shares one request, so they should "arrive" together) or the plain URL
  // for a full image.
  const delayKey = resolved ? (resolved.kind === 'sprite' ? resolved.sheetUrl : resolved.url) : '';
  // `coverDelayMs` self-gates on mock mode (returns 0 in real mode), so real thumbnails get no fake
  // latency — no gate needed here. Already-resolved keys also skip the delay on a revisit (see
  // `resolvedThumbIds`) — a recycle shouldn't re-simulate latency for a thumbnail already shown.
  const delay = useMemo(
    () => (resolvedThumbIds.has(delayKey) ? 0 : coverDelayMs(delayKey)),
    [delayKey],
  );
  const [delayPassed, setDelayPassed] = useState(delay === 0);
  useEffect(() => {
    // MUST assert delayPassed=true when there's no delay — not just early-return. A lazy tile's key
    // goes from '' (which may hash to a >0 mock delay) to the resolved sheet (which may hash to 0);
    // the deps-change cleanup clears the pending timeout, and a bare return would leave the stale
    // `false`, hiding the tile forever (the "shimmers past page 20" bug).
    if (delay === 0) {
      setDelayPassed(true);
      return;
    }
    setDelayPassed(false);
    setLoaded(false);
    const t = setTimeout(() => setDelayPassed(true), delay);
    return () => clearTimeout(t);
  }, [delay, delayKey]);

  // Bridges' page thumbnails aren't always exactly 2:3. A `sprite` tile's
  // shape is already known synchronously from its `{w,h}` crop (just capped
  // so it never renders taller than the default skeleton shape — since that
  // only ever shrinks the crop within its own bounds, it can't bleed in
  // neighbouring sheet pixels). A plain `image` tile's shape isn't known until
  // it's fetched, so it now mounts at the default shape and adopts its real
  // (capped) aspect from the visible image's own `onLoad` — no off-screen
  // `Image.loadAsync` prefetch (that kept a second decoded image per tile and
  // added a re-render each, a per-tile cost that showed up as main-thread
  // stalls across a full page grid). The grid slot below stays a constant shape
  // regardless, so a shorter/taller tile never reflows its row while the aspect
  // settles.
  const imageUrl = resolved?.kind === 'image' ? resolved.url : null;
  // Resolve the (possibly server-relative / embedded-transport) image URL through the transport
  // first — the same lazy resolution `SpriteCrop` does for its sheet. Resolving the raw URL would
  // skip embedded-mode asset resolution and fail to load. Empty string for a sprite tile resolves
  // synchronously to '' and is never used.
  const resolvedImageUrl = useResolvedThumbUrl(imageUrl ?? '', (msg) =>
    logDiagnostic('page-thumb-image', msg, {
      url: imageUrl ?? '',
      context: `bridge=${bridgeId ?? ''} series=${seed} page=${index}`,
    }),
  );
  const aspectRatio = resolved?.kind === 'sprite' ? clampThumbAspect(resolved.w / resolved.h) : imageAspect;
  const ready = delayPassed && loaded;
  // The tile's BOX shape. In the grid it is the slot's shape, so the tile always fills its slot
  // exactly and the picture inside crops to cover it — a box sized to the image's own aspect is what
  // left a strip of background under every tile. In the rail there is no slot: the box takes the
  // image's real aspect and the width follows, so nothing is ever cropped there.
  // The box in PIXELS — what the sprite crop has to fill.
  //
  // MEASURED, not computed. This was the bug behind the grey strip, and the old code confessed to it:
  // the crop was scaled by the `width` prop — derived from screen-width arithmetic and the grid's own
  // gap/padding maths, "≈ the cell width" — while the box is laid out by FLEX, to the real cell width.
  // The two disagree by a couple of px on device. Scale a 2:3 crop by a width 3px short and its HEIGHT
  // lands ~4px short of the box, so the tile's placeholder grey shows beneath every thumbnail. The
  // browser's layout happened to agree with the estimate, which is why it never reproduced there.
  //
  // With the box measured, the crop cannot disagree with the thing it fills — so the tile is free to
  // keep its OWN aspect (see `aspectRatio` on the box below) instead of being squashed into a uniform
  // slot. A short-lived version of this file did exactly that, and flattened every page to one shape.
  const boxWidth = boxSize ? boxSize.w : slotHeight != null ? slotHeight * aspectRatio : width;
  const boxHeight = boxSize ? boxSize.h : slotHeight != null ? slotHeight : width / aspectRatio;

  // Body as a render-prop of the shrink API: mounted inside ThumbShrink when the Lightweight lever is
  // off (real animated style), or called directly with the no-op API when it's on — in which case the
  // reanimated hooks are never allocated at all. Same shape as SeriesCard's renderCardBody.
  const renderTileBody = (shrink: ThumbShrinkApi) => {
    const pictureInner = (
      <>
        {delayPassed && resolved?.kind === 'image' && resolvedImageUrl && (
          <Image
            source={{ uri: resolvedImageUrl }}
            style={styles.thumbImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={lightCards ? 0 : 90}
            // Reset the reused image view on recycle so it doesn't flash the
            // previous page's thumbnail (see SeriesCard).
            recyclingKey={String(index)}
            onLoad={(e) => {
              resolvedThumbIds.add(delayKey);
              const src = e.source;
              if (src?.width && src?.height) {
                const nextAspect = clampThumbAspect(src.width / src.height);
                resolvedThumbAspects.set(delayKey, nextAspect);
                lastResolvedThumbAspect = nextAspect;
                // Smooth the aspect settle when the shape changes; a no-op when Lightweight is on.
                shrink.runShrink?.(imageAspect, nextAspect, boxSize?.w ?? 0);
                setImageAspect(nextAspect);
              }
              // Light path: the clip's own grey backing IS the placeholder and expo-image paints
              // over it natively, so there's no skeleton to hide — and thus no reason to spend a
              // state commit per tile flipping `loaded` (same reasoning as SeriesCard).
              if (!lightCards) setLoaded(true);
            }}
            onError={(e: { error?: string }) =>
              logDiagnostic('page-thumb-image', e.error || 'load failed', {
                url: resolved.url,
                context: `bridge=${bridgeId ?? ''} series=${seed} page=${index}`,
              })
            }
          />
        )}
        {delayPassed && resolved?.kind === 'sprite' && (
          <SpriteCrop
            thumb={resolved}
            width={boxWidth}
            height={boxHeight}
            transition={lightCards ? 0 : 200}
            onLoad={() => {
              resolvedThumbIds.add(delayKey);
              if (!lightCards) setLoaded(true);
            }}
            onError={(msg) =>
              logDiagnostic('page-thumb-sprite', msg, {
                url: resolved.sheetUrl,
                context: `bridge=${bridgeId ?? ''} series=${seed} page=${index}`,
              })
            }
          />
        )}
        {!ready && !lightCards && <Skeleton style={StyleSheet.absoluteFill} />}
      </>
    );
    return (
    // Fill the grid cell rather than sizing to an explicit `width`: the cell (flex:1, gap-aware) is
    // the source of truth, so the tile can't end up a hair wider than its column and get its right
    // corners clipped. The `width` prop is only a FIRST-FRAME estimate for the crop — `onLayout`
    // below replaces it with the box's real size (see boxWidth/boxHeight).
    <Pressable
      testID={testId('series.page', seed, page)}
      style={slotHeight != null ? { height: slotHeight, aspectRatio } : styles.thumbShell}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}>
      <View
        style={[styles.thumbBox, { aspectRatio }]}
        onLayout={(layoutEvent) => {
          const { width: laidOutW, height: laidOutH } = layoutEvent.nativeEvent.layout;
          // Feed the crop the box's TRUE size. Guarded so a no-op layout pass can't loop re-renders.
          if (!boxSize || Math.abs(boxSize.w - laidOutW) > 0.5 || Math.abs(boxSize.h - laidOutH) > 0.5) {
            setBoxSize({ w: laidOutW, h: laidOutH });
          }
        }}>
        <View style={styles.thumbClip}>
          {/* Picture layer, scaled by `pictureStyle` to fake the shrink illusion; `pageNum` is a
              sibling so it never gets stretched. The Lightweight path skips the wrapper VIEW entirely
              (no animated style, one less view per tile) and renders straight into the clip — the
              image, sprite and skeleton all fill it on their own. Mirrors SeriesCard. */}
          {shrink.pictureStyle ? (
            <Animated.View style={[StyleSheet.absoluteFill, styles.thumbPicture, shrink.pictureStyle]}>
              {pictureInner}
            </Animated.View>
          ) : (
            pictureInner
          )}
          {showPageNumber && (
            <View style={styles.pageNum}>
              <ThemedText style={styles.pageNumText}>{page}</ThemedText>
            </View>
          )}
        </View>
      </View>
      {/* Hover ring (brighten, not dim) — same highlight treatment as SeriesCard's
       *  own hover/active ring, since an opacity-dim over an image reads as broken. */}
      {hovered && <View style={[styles.thumbRing, { pointerEvents: 'none' }]} />}
    </Pressable>
    );
  };

  return lightCards ? (
    renderTileBody(NOOP_THUMB_SHRINK)
  ) : (
    <ThumbShrink index={index}>{renderTileBody}</ThumbShrink>
  );
}

/** Crops a `sprite`-kind thumbnail's tile out of its shared sheet image. The sheet loads once —
 *  `expo-image`'s cache keys on `sheetUrl`, so every tile cut from the same sheet reuses one
 *  request — scaled so the tile matches `width`, then offset so only its `{x,y,w,h}` rect shows
 *  through the tile's `overflow: hidden` bounds (`styles.thumbClip`). Same idea as a CSS sprite: plain
 *  View/Image layout math, so it renders identically on web, iOS, and Android with no SVG or
 *  native region-decoding needed.
 *
 *  `sheetWidth` is a real sheet-pixel dimension (the montage's x/width coordinates), but `sheetHeight`
 *  is only the tiles' bottom extent (`max(y+h)`) — some montage sheets carry a few px of trailing
 *  padding below the last tile, so the real image is a touch taller than `sheetHeight`. Forcing the
 *  image into `sheetHeight*scale` with `contentFit="fill"` squashes that padding in and leaves a blank
 *  (black) strip at each tile's bottom. Instead lock the horizontal scale to `sheetWidth` and let the
 *  height follow the image's true aspect: `cover` scales to the more-constraining axis, and since
 *  `sheetHeight ≤ naturalHeight` the width always wins — so both axes get the same `scale` (no squash),
 *  the real trailing padding renders past the box and is clipped rather than compressed. `top left`
 *  anchors the crop origin. This mirrors comical-web's `preserveAspectRatio="xMinYMin meet"` SVG. */
function SpriteCrop({
  thumb,
  width,
  height,
  transition = 200,
  onLoad,
  onError,
}: {
  thumb: SpriteThumb;
  /** The box to fill, in px. The crop COVERS it (see `scale`), so the tile never falls short of it. */
  width: number;
  height: number;
  /** Cross-fade duration; 0 on the Lightweight path (see PageThumb). */
  transition?: number;
  onLoad?: () => void;
  onError?: (message: string) => void;
}) {
  // Resolve the sprite sheet lazily — only once this tile mounts — and deduped, so a montage sheet
  // shared by many tiles is fetched once, on demand, instead of once per tile up front. `null` until
  // resolved; the parent tile shows its skeleton (no `onLoad` yet) in the meantime.
  const sheet = useResolvedThumbUrl(thumb.sheetUrl, onError);
  // COVER the box (the larger of the two scales), rather than matching its width and letting the
  // height land where it may — a tile whose shape didn't match its slot came up short and left a
  // strip of background beneath it. The excess now overflows and is clipped instead, which is what a
  // cover-fit thumbnail does everywhere else in the app.
  //
  // The +1 is the important part, and it's why this bug survived two "fixes". A source whose tiles
  // are EXACTLY the slot's shape (a 200x300 cell in a 2:3 slot — the common case) makes both scales
  // identical, so the crop lands on precisely the box's height... which is a FRACTIONAL layout value
  // (a column width like 177.66 gives a 266.49 box). Round that down on the native pixel grid and the
  // picture ends a hair above its box: a 1px grey hairline under every single thumbnail, on device
  // only — web rounds the other way, which is why it never showed up in a browser. Overscanning by a
  // pixel makes the crop always slightly larger than the box, so rounding can never expose the
  // background. A pixel of extra crop is invisible.
  const scale = Math.max((width + 1) / thumb.w, (height + 1) / thumb.h);
  // Centre the crop horizontally when it's wider than the box (so a fill trims both edges evenly
  // rather than lopping off the right), but keep it TOP-aligned vertically — the top of a page is
  // the part worth showing.
  const overflowX = thumb.w * scale - width;
  if (!sheet) return null;
  return (
    <Image
      source={{ uri: sheet }}
      style={{
        position: 'absolute',
        width: thumb.sheetWidth * scale,
        height: thumb.sheetHeight * scale,
        left: -thumb.x * scale - overflowX / 2,
        top: -thumb.y * scale,
      }}
      contentFit="cover"
      contentPosition={{ top: 0, left: 0 }}
      cachePolicy="memory-disk"
      transition={transition}
      onLoad={onLoad}
      onError={(e: { error?: string }) => onError?.(e.error || 'load failed')}
    />
  );
}

/** Resolve a raw (possibly server-relative) thumbnail asset URL lazily — only after the tile has
 *  mounted, so a long page grid resolves thumbnails on demand (and dedupes a shared sprite sheet)
 *  rather than resolving every page up front. `null` until resolved; a resolve failure calls `onError`
 *  so the tile falls back like any load failure. Absolute URLs resolve synchronously (cheap identity).*/
function useResolvedThumbUrl(url: string, onError?: (message: string) => void): string | null {
  const [resolved, setResolved] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Recycle-safety: PageThumb reuses this hook's instance for a different page
  // as the grid scrolls (recycleItems), and only the `url` prop changes — the
  // stale `resolved` value from the PREVIOUS page otherwise survives into the
  // first render with the new url (this state only cleared inside the effect
  // below, which runs a commit later), so that first frame renders the old
  // tile's resolved image/sheet under the new tile's geometry — the "stale
  // thumbnail" flash. Clear it synchronously during render instead (same
  // ref-compare pattern as PageThumb/SeriesCard's own per-item reset), so the
  // gap is never visible; the effect still does the actual async resolve.
  const prevUrlRef = useRef(url);
  if (prevUrlRef.current !== url) {
    prevUrlRef.current = url;
    setResolved(null);
  }

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    resolveAssetSourceCached(url)
      .then((u) => {
        if (!cancelled) setResolved(u);
      })
      .catch((e: unknown) => {
        if (!cancelled) onErrorRef.current?.((e as Error)?.message || 'resolve failed');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return resolved;
}

/** A gentle vertical transparent→`color` fade over the last collapsed row; only
 *  the very bottom reaches solid (where it meets the page background), so the
 *  "Show all" button floats over the still-visible, fading thumbnails rather than
 *  a solid block. Mirrors the reference's `.page-thumbs-more`. */
function GradientFade({ color }: { color: string }) {
  return (
    <LinearGradient
      colors={['transparent', color, color]}
      locations={[0, 0.8, 1]}
      style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
    />
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
  // ── Page-thumbnail list (PageThumbList) ──────────────────────────────────
  pageList: {
    flex: 1,
  },
  pageHeader: {
    gap: Spacing.four,
  },
  pageFooter: {
    gap: Spacing.four,
    paddingTop: Spacing.two,
  },
  // The collapsed "Show all" overlay: pulled up over the last visible row (height
  // + negative marginTop set inline), the gradient fades that row out and the
  // button sits centred at the bottom of the fade.
  moreOverlay: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: Spacing.three,
  },
  // Reinstates the title→grid gap between the "Pages" heading and the first tile
  // row (the list's items start immediately after the header otherwise).
  pagesHeading: {
    marginBottom: Spacing.three,
  },
  // Rails span the full capped column; cancel the list's Spacing.four side inset.
  pageFooterRails: {
    marginHorizontal: -Spacing.four,
  },
  // A grid cell. NO `flex: 1` — it's pinned to `tileW` at the call site, so a short last row ends
  // instead of stretching. The paddingBottom is the inter-row gap (LegendList's columnWrapperStyle
  // only supplies the column gap).
  pageCell: {
    paddingBottom: Spacing.two,
  },
  head: {
    gap: Spacing.two,
  },
  headTitle: {
    // Reference .chapters-head h3: 1.15rem (~18px).
    fontSize: 18,
    lineHeight: 24,
  },
  skelRows: {
    gap: Spacing.two,
  },
  skelChapterRow: {
    height: 44,
    borderRadius: Spacing.two,
  },
  skelTileRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  skelTile: {
    flex: 1,
    aspectRatio: DEFAULT_THUMB_ASPECT,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tabs: {
    // Content-sized (not `flex: 1` on each child, and not `flex: 1` on the
    // strip itself) — a tab's width follows its own label, so "All" and
    // "Overview" don't get forced to the same width, and the whole strip
    // doesn't stretch to the row's full width leaving a big dead-space pill
    // before the sort button. Fixed height (matching the sort button) rather
    // than letting padding drive it, so the whole controls row reads as one
    // consistent height.
    height: CONTROLS_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: TAB_PAD,
    gap: TAB_GAP,
  },
  // Sliding highlight behind the active option (see `Segmented`) — sized to
  // exactly overlay the active option's own rect (same top/bottom inset from
  // the strip's padding, same radius as `tab`/`sortTab`), so the selected
  // state reads as the same shape as the hover highlight, just filled with
  // the accent color instead of `backgroundSelected`. x/width come from the
  // active option's own measured layout, and transition via the `layout` prop
  // when that changes.
  tabPill: {
    position: 'absolute',
    top: TAB_PAD,
    bottom: TAB_PAD,
    left: 0,
    borderRadius: 8,
  },
  tab: {
    height: CONTROLS_HEIGHT - TAB_PAD * 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
  },
  tabLabel: {
    // Reference .ch-tab: 0.82rem (~13px). Every tab is sized to its own label
    // now (not squeezed into an equal-width slice), so this can be full size.
    fontSize: 13,
    textAlign: 'center',
  },
  // The sort toggle's own segmented items: square icon buttons rather than
  // label-width text tabs.
  sortTab: {
    height: CONTROLS_HEIGHT - TAB_PAD * 2,
    width: CONTROLS_HEIGHT - TAB_PAD * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  list: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowName: {
    flex: 1,
    fontWeight: '600',
  },
  rowTime: {
    fontSize: 12,
  },
  // Trailing per-chapter download indicator — sits between the name and the time.
  rowDownload: {
    marginRight: Spacing.one,
  },
  // The long-press chapter menu (ChapterDownloadMenu).
  menuBody: {
    gap: Spacing.three,
  },
  // Offline + not downloaded: the chapter can't be read, so the whole row reads as unavailable.
  rowDimmed: {
    opacity: 0.4,
  },
  // The "N versions ▾" toggle inside a row — sits between the name and the time.
  versionsBtn: {
    paddingHorizontal: Spacing.one,
  },
  // The expanded per-version list, indented under its logical-chapter row.
  versionList: {
    marginTop: Spacing.one,
    marginLeft: Spacing.four,
    gap: Spacing.one,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  versionLabel: {
    flex: 1,
    fontSize: 12,
  },
  empty: {
    paddingVertical: Spacing.three,
  },
  // Overview's middle expand affordance — plain centred accent text (no chrome).
  expandMiddle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
  },
  expandMiddleText: {
    fontWeight: '600',
  },
  showMore: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  thumbRing: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#60a5fa',
  },
  thumbShell: {
    // Constant slot — the 2:3 default, the vertical MAX a tile can occupy (clampThumbAspect floors
    // every aspect there, so no tile can exceed it). Never resizes, so a tile's row never reflows and
    // the grid stays virtualizable at a fixed row height. A tile SHORTER than this top-aligns inside
    // it — that's how the grid keeps each page's own shape.
    aspectRatio: DEFAULT_THUMB_ASPECT,
  },
  thumbBox: {
    // The tile itself, at its real (capped) aspect ratio — `thumbShell` above is the
    // constant 2:3 slot this top-aligns within.
    width: '100%',
    position: 'relative',
  },
  thumbClip: {
    // Fixed (never transformed) clipping ancestor — the scaled `thumbPicture`
    // layer sits inside this, since clipping the SAME element being scaled
    // wouldn't actually contain overflow (the clip rect would scale too).
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  thumbPicture: {
    // Top-aligned scale origin so the shrink illusion (`picturePageStyle`)
    // settles toward the bottom, matching `thumbBox`'s own top-aligned layout.
    transformOrigin: 'top',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  pageNum: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pageNumText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
});
