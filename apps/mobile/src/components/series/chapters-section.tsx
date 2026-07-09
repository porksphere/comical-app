import { LegendList } from '@legendapp/list/react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrowDownIcon, ArrowUpIcon } from '@/components/icons/ui-icons';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { isAbort, resolveAssetSourceCached } from '@/data/api';
import { coverDelayMs, relativeTime } from '@/data/mock';
import { useDataSource } from '@/data/source';
import type { Chapter, PageThumbSource, SpriteThumb } from '@/data/types';
import { ASPECT_TRANSITION_MS, clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { groupChapters, pickVersion, type ChapterGroup } from '@/lib/chapter-order';
import { setPreferredGroup, usePreferredGroup } from '@/lib/preferred-group';
import { logDiagnostic } from '@/lib/diagnostics';

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
}) {
  // Direct-series page thumbnails are no longer rendered here — they're the
  // series screen's own virtualized scroller (see `PageThumbList`); this section
  // is just the chaptered-series list now.
  if (loading) return <ChapterListSkeleton />;
  return chapters?.length ? (
    <ChapterList chapters={chapters} seed={seed} title={title} bridgeId={bridgeId} />
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
  options: { id: T; render: (active: boolean) => ReactNode; accessibilityLabel?: string }[];
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
  onPress,
  onLayout,
  children,
}: {
  active: boolean;
  itemStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  onPress: () => void;
  onLayout: (x: number, width: number) => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
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
}: {
  chapters: Chapter[];
  seed: string;
  title: string;
  bridgeId?: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [asc, setAsc] = useState(false);
  // Overview-only: reveal the collapsed middle portion inline.
  const [middleExpanded, setMiddleExpanded] = useState(false);
  const expandMiddleHover = useHovered();

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

  const row = (g: ChapterGroup) => (
    <ChapterRow key={g.key} group={g} preferredGroup={preferredGroup} onOpen={openVersion} />
  );

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
}: {
  group: ChapterGroup;
  preferredGroup?: string;
  onOpen: (v: Chapter) => void;
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
    <View>
      <Pressable
        onPress={() => onOpen(def)}
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
          {multi && (
            <Pressable
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
  );
}

// Rows of tiles shown before a long page set collapses behind "Show all".
const COLLAPSED_ROWS = 4;

/** Sentinel for a trailing spacer cell that pads a short last row (see `data`). */
const SPACER = Symbol('page-spacer');

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
}: {
  thumbs: (PageThumbSource | null)[];
  /** The deferred page list is still fetching — show a skeleton in the header. */
  loading?: boolean;
  seed: string;
  title: string;
  bridgeId?: string;
  /** Series hero/meta — the list header (this component owns the scroller). */
  header?: ReactElement | null;
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
  // The collapsed fade height mirrors the reference's `.page-thumbs-more`: ~0.6 of
  // a tile's height, so the last row reads as fading out under the button.
  const fadeHeight = Math.round(tileW * (3 / 2) * 0.6);

  const collapsedCount = cols * COLLAPSED_ROWS;
  // Only collapse behind "Show all" when there's a footer (related rails, or
  // its loading skeleton) worth keeping reachable — that's the entire reason
  // this gate exists. A series with nothing below the grid has nothing to
  // protect, so just render the full (already-virtualized) list directly.
  const collapsed = !expanded && !!footer && thumbs.length > collapsedCount;
  // Collapsed shows the first few rows (so the rails stay reachable); expanded
  // shows all, virtualized. Pad the last (short) row with spacers so its tiles
  // keep their column width instead of the flex cell stretching them — same
  // pattern as the browse grid. Empty while loading (the header shows the page
  // skeleton instead).
  const base = loading ? [] : collapsed ? thumbs.slice(0, collapsedCount) : thumbs;
  const data = useMemo<(PageThumbSource | null | symbol)[]>(() => {
    const remainder = base.length % cols;
    if (base.length === 0 || remainder === 0) return base;
    return [...base, ...Array.from({ length: cols - remainder }, () => SPACER)];
  }, [base, cols]);

  return (
    <LegendList
      style={styles.pageList}
      data={data}
      keyExtractor={(_, i) => String(i)}
      numColumns={cols}
      recycleItems
      estimatedItemSize={tileW * (3 / 2) + gap}
      columnWrapperStyle={{ gap }}
      contentContainerStyle={{
        paddingTop: Spacing.four,
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
      renderItem={({ item, index }) =>
        item === SPACER ? (
          <View style={styles.pageCell} />
        ) : (
          <View style={styles.pageCell}>
            <PageThumb
              thumb={item as PageThumbSource | null}
              index={index}
              seed={seed}
              bridgeId={bridgeId}
              page={index + 1}
              width={tileW}
              onPress={() =>
                router.push({
                  pathname: '/reader',
                  params: { seed, title, direct: '1', start: String(index), ...(bridgeId ? { bridgeId } : {}) },
                })
              }
            />
          </View>
        )
      }
    />
  );
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
function PageThumb({
  thumb,
  index,
  seed,
  bridgeId,
  page,
  width,
  onPress,
}: {
  thumb: PageThumbSource | null;
  index: number;
  seed: string;
  bridgeId?: string;
  page: number;
  width: number;
  onPress?: () => void;
}) {
  const ds = useDataSource();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const [resolved, setResolved] = useState(thumb);
  const [loaded, setLoaded] = useState(false);
  // Real aspect of a plain `image` tile, learned from its own onLoad (see the
  // note on the derivation below) rather than an off-screen prefetch. A plain,
  // UNanimated value — like SeriesCard's `coverAspect`, this only ever shrinks
  // from the default (never grows past it), so setting it is always a single,
  // one-time relayout of `thumbBox`. The *visual* shrink is smoothed separately
  // by `picturePageStyle` (pure `transform`, no further relayout) below.
  const [imageAspect, setImageAspect] = useState(DEFAULT_THUMB_ASPECT);
  // FLIP-style shrink illusion, same technique as SeriesCard's cover — no
  // trailing-group equivalent needed here since `thumbShell` is a constant 2:3
  // slot and `pageNum` sits outside the scaled layer, so nothing else needs to
  // shift when the tile's real aspect lands.
  const thumbWidthSV = useSharedValue(0);
  const shrinkProgressSV = useSharedValue(1); // 1 = settled; animates 0 -> 1 per transition
  const shrinkFromScaleSV = useSharedValue(1); // picture's scaleY at progress 0

  // Recycle-safety: the page grid uses recycleItems, so this instance is reused
  // for a different page as the list scrolls. Reset per-tile state synchronously
  // when the page index changes (React's "adjust state on prop change" pattern,
  // same as SeriesCard) so a reused tile doesn't briefly show the previous
  // page's thumbnail/aspect. No-op on a fresh mount.
  const prevIndexRef = useRef(index);
  if (prevIndexRef.current !== index) {
    prevIndexRef.current = index;
    setResolved(thumb);
    setLoaded(false);
    setImageAspect(DEFAULT_THUMB_ASPECT);
    shrinkProgressSV.value = 1;
    shrinkFromScaleSV.value = 1;
  }

  useEffect(() => {
    if (resolved || !bridgeId) return;
    const ctrl = new AbortController();
    ds.getPageThumb(bridgeId, seed, index, ctrl.signal)
      .then((fetched) => {
        if (fetched) setResolved(fetched);
      })
      .catch((e) => {
        // Non-fatal: the tile just stays a skeleton — but log it so a bridge that always fails
        // this lookup is visible somewhere instead of just an unexplained blank grid.
        if (!isAbort(e)) {
          logDiagnostic('page-thumb-fetch', (e as Error).message || String(e), {
            context: `bridge=${bridgeId} series=${seed} page=${index}`,
          });
        }
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeId, seed, index]);

  // A stable key for the simulated-latency hash: the sheet URL for a sprite tile (every tile cut
  // from the same sheet shares one request, so they should "arrive" together) or the plain URL
  // for a full image.
  const delayKey = resolved ? (resolved.kind === 'sprite' ? resolved.sheetUrl : resolved.url) : '';
  // `coverDelayMs` self-gates on mock mode (returns 0 in real mode), so real thumbnails get no fake
  // latency — no gate needed here.
  const delay = useMemo(() => coverDelayMs(delayKey), [delayKey]);
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
  // stalls across a full page grid). `thumbShell` below stays the constant
  // default-shape slot regardless, so a shorter/taller tile never reflows its
  // row while the aspect settles.
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

  // The picture layer's scaleY: eases from its old apparent size down to 1 (its
  // real, already-committed size) as `shrinkProgressSV` runs 0 -> 1 — same
  // technique as SeriesCard's `pictureStyle`. `styles.thumbPicture` fixes
  // `transformOrigin: 'top'` to match `thumbBox`'s own top-aligned layout.
  const picturePageStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: shrinkFromScaleSV.value + (1 - shrinkFromScaleSV.value) * shrinkProgressSV.value }],
  }));

  return (
    // Fill the grid cell rather than sizing to an explicit `width`: the cell
    // (flex:1, gap-aware) is the source of truth, so the tile can't end up a
    // hair wider than its column and get its right corners clipped. `width` is
    // still the pixel width for SpriteCrop's crop math (≈ the cell width).
    <Pressable style={styles.thumbShell} onPress={onPress} onHoverIn={onHoverIn} onHoverOut={onHoverOut}>
      <View
        style={[styles.thumbBox, { aspectRatio }]}
        onLayout={(layoutEvent) => {
          thumbWidthSV.value = layoutEvent.nativeEvent.layout.width;
        }}>
        <View style={styles.thumbClip}>
          {/* The picture layer: scaled by `picturePageStyle` to fake the shrink
              illusion. `pageNum` below is a sibling, NOT inside this layer, so
              it never gets stretched by the scale. */}
          <Animated.View style={[StyleSheet.absoluteFill, styles.thumbPicture, picturePageStyle]}>
            {delayPassed && resolved?.kind === 'image' && resolvedImageUrl && (
              <Image
                source={{ uri: resolvedImageUrl }}
                style={styles.thumbImg}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={90}
                // Reset the reused image view on recycle so it doesn't flash the
                // previous page's thumbnail (see SeriesCard).
                recyclingKey={String(index)}
                onLoad={(e) => {
                  const src = e.source;
                  if (src?.width && src?.height) {
                    const nextAspect = clampThumbAspect(src.width / src.height);
                    // Same FLIP kick-off as SeriesCard: only animate when there's
                    // an actual shape change and the box's pixel width is already
                    // known (from onLayout above).
                    const boxWidth = thumbWidthSV.value;
                    if (boxWidth > 0 && nextAspect !== imageAspect) {
                      const oldHeight = boxWidth / imageAspect;
                      const newHeight = boxWidth / nextAspect;
                      shrinkFromScaleSV.value = newHeight > 0 ? oldHeight / newHeight : 1;
                      shrinkProgressSV.value = 0;
                      shrinkProgressSV.value = withTiming(1, {
                        duration: ASPECT_TRANSITION_MS,
                        easing: Easing.out(Easing.cubic),
                      });
                    }
                    setImageAspect(nextAspect);
                  }
                  setLoaded(true);
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
                width={width}
                onLoad={() => setLoaded(true)}
                onError={(msg) =>
                  logDiagnostic('page-thumb-sprite', msg, {
                    url: resolved.sheetUrl,
                    context: `bridge=${bridgeId ?? ''} series=${seed} page=${index}`,
                  })
                }
              />
            )}
            {!ready && <Skeleton style={StyleSheet.absoluteFill} />}
          </Animated.View>
          <View style={styles.pageNum}>
            <ThemedText style={styles.pageNumText}>{page}</ThemedText>
          </View>
        </View>
      </View>
      {/* Hover ring (brighten, not dim) — same highlight treatment as SeriesCard's
       *  own hover/active ring, since an opacity-dim over an image reads as broken. */}
      {hovered && <View style={[styles.thumbRing, { pointerEvents: 'none' }]} />}
    </Pressable>
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
  onLoad,
  onError,
}: {
  thumb: SpriteThumb;
  width: number;
  onLoad?: () => void;
  onError?: (message: string) => void;
}) {
  // Resolve the sprite sheet lazily — only once this tile mounts — and deduped, so a montage sheet
  // shared by many tiles is fetched once, on demand, instead of once per tile up front. `null` until
  // resolved; the parent tile shows its skeleton (no `onLoad` yet) in the meantime.
  const sheet = useResolvedThumbUrl(thumb.sheetUrl, onError);
  const scale = width / thumb.w;
  if (!sheet) return null;
  return (
    <Image
      source={{ uri: sheet }}
      style={{
        position: 'absolute',
        width: thumb.sheetWidth * scale,
        height: thumb.sheetHeight * scale,
        left: -thumb.x * scale,
        top: -thumb.y * scale,
      }}
      contentFit="cover"
      contentPosition={{ top: 0, left: 0 }}
      cachePolicy="memory-disk"
      transition={200}
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
  // A grid cell: fills its column; the paddingBottom is the inter-row gap
  // (LegendList's columnWrapperStyle only supplies the column gap).
  pageCell: {
    flex: 1,
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
  thumbShell: {
    // Constant slot — always the default 2:3 shape, the vertical max a tile
    // can occupy. Never resizes, so a tile's row never reflows.
    aspectRatio: DEFAULT_THUMB_ASPECT,
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
  thumbBox: {
    // The tile itself, at its real (capped) aspect ratio — `thumbShell` above
    // is the constant 2:3 slot this top-aligns within.
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
