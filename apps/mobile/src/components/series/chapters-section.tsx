import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isAbort } from '@/data/api';
import { coverDelayMs, relativeTime } from '@/data/mock';
import { useDataSource } from '@/data/source';
import type { Chapter, PageThumbSource, SpriteThumb } from '@/data/types';

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
// Overview collapses long lists to a configurable number of chapters from the
// start and the end, with an expand button between them for the hidden middle.
const OVERVIEW_HEAD_COUNT = 5;
const OVERVIEW_TAIL_COUNT = 5;
// Must match `styles.tabs`'s `padding`/`gap` — used to compute the sliding
// highlight's geometry from the strip's measured width.
const TAB_PAD = 3;
const TAB_GAP = 2;

/** Pulls the chapter number out of a display name like "Chapter 176 — The Spirit
 *  Zone" (preferring a number right after "chapter"/"ch.", so a stray number
 *  elsewhere in a title doesn't win) — `null` for names with no parseable number
 *  (a oneshot/extra), which falls back to sorting by `date` instead. */
function chapterNumber(name: string): number | null {
  const afterKeyword = name.match(/\bch(?:apter)?\.?\s*#?(\d+(?:\.\d+)?)/i);
  if (afterKeyword) return parseFloat(afterKeyword[1]);
  const anyNumber = name.match(/\d+(?:\.\d+)?/);
  return anyNumber ? parseFloat(anyNumber[0]) : null;
}

/** Chapters should read in their real numeric sequence, not publish order — a
 *  bridge's `date` isn't guaranteed monotonic with chapter number (same-day
 *  batch drops, backfills/re-scans, bonus chapters uploaded out of order all
 *  produce a `date` that disagrees with the actual chapter sequence). Falls
 *  back to `date` only when a number can't be parsed from one side (a oneshot/
 *  extra) or both sides parse to the same number. */
function compareChapters(a: Chapter, b: Chapter, asc: boolean): number {
  const numA = chapterNumber(a.name);
  const numB = chapterNumber(b.name);
  if (numA != null && numB != null && numA !== numB) return asc ? numA - numB : numB - numA;
  return asc ? a.date - b.date : b.date - a.date;
}

export function ChaptersSection({
  chapters,
  pageThumbs,
  seed,
  title,
  bridgeId,
  only,
}: {
  chapters?: Chapter[];
  pageThumbs?: (PageThumbSource | null)[];
  /** Series identity, used to build reader navigation params. */
  seed: string;
  title: string;
  /** Originating bridge's stable id, carried to the reader for real API calls. */
  bridgeId?: string;
  /** Render just one sub-part. On large screens the series detail puts the
   *  chapter list in the right column (`'chapters'`) but the page-thumbnail grid
   *  full-width below the columns (`'pages'`), mirroring the reference where
   *  `#page-thumbs` sits outside `.detail-head`. Omitted = whichever applies. */
  only?: 'chapters' | 'pages';
}) {
  if (only === 'chapters') {
    return chapters?.length ? (
      <ChapterList chapters={chapters} seed={seed} title={title} bridgeId={bridgeId} />
    ) : null;
  }
  if (only === 'pages') {
    return pageThumbs?.length ? (
      <PageThumbGrid thumbs={pageThumbs} seed={seed} title={title} bridgeId={bridgeId} />
    ) : null;
  }
  if (pageThumbs?.length) return <PageThumbGrid thumbs={pageThumbs} seed={seed} title={title} bridgeId={bridgeId} />;
  if (chapters?.length) return <ChapterList chapters={chapters} seed={seed} title={title} bridgeId={bridgeId} />;
  return null;
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

  // Sliding highlight behind the active tab — measured from the tab strip's own
  // width (all `TABS` are equal `flex: 1` slices) rather than per-tab `onLayout`,
  // so its position/width are exact even before any tab has individually laid out.
  const [tabsWidth, setTabsWidth] = useState(0);
  const segmentWidth =
    tabsWidth > 0 ? (tabsWidth - TAB_PAD * 2 - TAB_GAP * (TABS.length - 1)) / TABS.length : 0;
  const activeIndex = TABS.findIndex((t) => t.id === tab);
  const pillX = useSharedValue(0);
  const pillMeasured = useRef(false);
  useEffect(() => {
    if (segmentWidth <= 0) return;
    const x = activeIndex * (segmentWidth + TAB_GAP);
    // Snap into place on first measurement (no slide-in from 0); animate every
    // change after that.
    if (!pillMeasured.current) {
      pillX.value = x;
      pillMeasured.current = true;
    } else {
      pillX.value = withTiming(x, { duration: 200 });
    }
  }, [activeIndex, segmentWidth, pillX]);
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: segmentWidth,
  }));

  const sorted = useMemo(() => {
    let list = chapters;
    if (tab === 'read') list = chapters.filter((c) => c.read);
    else if (tab === 'unread') list = chapters.filter((c) => !c.read);
    return [...list].sort((a, b) => compareChapters(a, b, asc));
  }, [chapters, tab, asc]);

  // Overview shows the first HEAD + last TAIL chapters, with the middle behind an
  // expand button. Only collapse when it hides ≥2 chapters (a button that hides a
  // single row isn't worth the space). Other tabs show their full filtered list.
  const collapsible =
    tab === 'overview' &&
    !middleExpanded &&
    sorted.length > OVERVIEW_HEAD_COUNT + OVERVIEW_TAIL_COUNT + 1;
  const hiddenCount = collapsible ? sorted.length - OVERVIEW_HEAD_COUNT - OVERVIEW_TAIL_COUNT : 0;
  const head = collapsible ? sorted.slice(0, OVERVIEW_HEAD_COUNT) : sorted;
  const tail = collapsible ? sorted.slice(sorted.length - OVERVIEW_TAIL_COUNT) : [];

  const row = (c: Chapter) => (
    <ChapterRow
      key={c.id}
      chapter={c}
      onPress={() =>
        router.push({
          pathname: '/reader',
          params: {
            seed,
            title,
            chapterId: c.id,
            chapterName: c.name,
            start: '0',
            ...(bridgeId ? { bridgeId } : {}),
          },
        })
      }
    />
  );

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <ThemedText type="subtitle" style={styles.headTitle}>
          Chapters
        </ThemedText>
        <View style={styles.controls}>
          <ThemedView
            type="backgroundElement"
            style={styles.tabs}
            onLayout={(e) => setTabsWidth(e.nativeEvent.layout.width)}>
            {segmentWidth > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[styles.tabPill, { backgroundColor: theme.accent }, pillStyle]}
              />
            )}
            {TABS.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  setTab(t.id);
                  setMiddleExpanded(false);
                }}
                style={styles.tab}>
                <ThemedText
                  type="small"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={[
                    styles.tabLabel,
                    tab === t.id ? { color: theme.accentOn } : { color: theme.textSecondary },
                  ]}>
                  {t.label}
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>
          <Pressable
            onPress={() => setAsc((v) => !v)}
            accessibilityLabel={asc ? 'Oldest first' : 'Newest first'}>
            <ThemedView type="backgroundElement" style={styles.sortBtn}>
              <ThemedText type="smallBold">{asc ? '↑' : '↓'}</ThemedText>
            </ThemedView>
          </Pressable>
        </View>
      </View>

      <View style={styles.list}>
        {head.map(row)}

        {collapsible && (
          <Pressable onPress={() => setMiddleExpanded(true)} style={styles.expandMiddle}>
            <ThemedText type="small" style={[styles.expandMiddleText, { color: theme.accent }]}>
              Show {hiddenCount} more chapters
            </ThemedText>
          </Pressable>
        )}

        {tail.map(row)}

        {sorted.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No chapters here.
          </ThemedText>
        )}
      </View>
    </View>
  );
}

function ChapterRow({ chapter, onPress }: { chapter: Chapter; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.rowPressed]}>
      <ThemedView type="backgroundElement" style={[styles.row, { borderColor: theme.hairline }]}>
        <ThemedText
          type="small"
          numberOfLines={1}
          style={[styles.rowName, chapter.read && { color: theme.textSecondary }]}>
          {chapter.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowTime}>
          {relativeTime(chapter.date)}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

// Rows shown before a long page set collapses behind "Show all".
const COLLAPSED_ROWS = 4;

function PageThumbGrid({
  thumbs,
  seed,
  title,
  bridgeId,
}: {
  thumbs: (PageThumbSource | null)[];
  seed: string;
  title: string;
  bridgeId?: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const [containerW, setContainerW] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const cols = screenW >= 900 ? 5 : screenW >= 600 ? 3 : 2;
  const gap = Spacing.two;
  const tileW = containerW > 0 ? (containerW - gap * (cols - 1)) / cols : 0;

  // Past a few rows, collapse: a gradient fades the last visible rows out under
  // a centered "Show all" button so it reads as "there's more". Mirrors the
  // reference's `.page-thumbs-more`.
  const collapsedCount = cols * COLLAPSED_ROWS;
  const collapsed = !expanded && thumbs.length > collapsedCount;
  const shown = collapsed ? thumbs.slice(0, collapsedCount) : thumbs;
  const fadeHeight = tileW > 0 ? Math.round(tileW * (3 / 2) * 0.6) : 120;

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.headTitle}>
        Pages
      </ThemedText>
      <View
        style={styles.thumbGridWrap}
        onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
        <View style={[styles.thumbGrid, { gap }]}>
          {tileW > 0 &&
            shown.map((thumb, i) => (
              <PageThumb
                key={i}
                thumb={thumb}
                index={i}
                seed={seed}
                bridgeId={bridgeId}
                page={i + 1}
                width={tileW}
                onPress={() =>
                  router.push({
                    pathname: '/reader',
                    params: { seed, title, direct: '1', start: String(i), ...(bridgeId ? { bridgeId } : {}) },
                  })
                }
              />
            ))}
        </View>

        {collapsed && (
          <View style={[styles.moreOverlay, { height: fadeHeight, pointerEvents: 'box-none' }]}>
            <GradientFade color={theme.background} />
            <Pressable onPress={() => setExpanded(true)} hitSlop={8}>
              <ThemedView
                type="backgroundElement"
                style={[styles.showMore, { borderColor: theme.hairline }]}>
                <ThemedText type="small" style={{ color: theme.accent }}>
                  Show all {thumbs.length} pages
                </ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        )}
      </View>
    </View>
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
  const [resolved, setResolved] = useState(thumb);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (resolved || !bridgeId) return;
    const ctrl = new AbortController();
    ds.getPageThumb(bridgeId, seed, index, ctrl.signal)
      .then((fetched) => {
        if (fetched) setResolved(fetched);
      })
      .catch((e) => {
        if (!isAbort(e)) {
          /* non-fatal: tile stays a skeleton */
        }
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeId, seed, index]);

  // A stable key for the simulated-latency hash: the sheet URL for a sprite tile (every tile cut
  // from the same sheet shares one request, so they should "arrive" together) or the plain URL
  // for a full image.
  const delayKey = resolved ? (resolved.kind === 'sprite' ? resolved.sheetUrl : resolved.url) : '';
  const delay = useMemo(() => coverDelayMs(delayKey), [delayKey]);
  const [delayPassed, setDelayPassed] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    setDelayPassed(false);
    setLoaded(false);
    const t = setTimeout(() => setDelayPassed(true), delay);
    return () => clearTimeout(t);
  }, [delay, delayKey]);
  const ready = delayPassed && loaded;
  const aspectRatio = resolved?.kind === 'sprite' ? resolved.w / resolved.h : 2 / 3;

  return (
    <Pressable style={[styles.thumb, { width, aspectRatio }]} onPress={onPress}>
      {delayPassed && resolved?.kind === 'image' && (
        <Image
          source={{ uri: resolved.url }}
          style={styles.thumbImg}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
          onLoad={() => setLoaded(true)}
        />
      )}
      {delayPassed && resolved?.kind === 'sprite' && (
        <SpriteCrop thumb={resolved} width={width} onLoad={() => setLoaded(true)} />
      )}
      {!ready && <Skeleton style={StyleSheet.absoluteFill} />}
      <View style={styles.pageNum}>
        <ThemedText style={styles.pageNumText}>{page}</ThemedText>
      </View>
    </Pressable>
  );
}

/** Crops a `sprite`-kind thumbnail's tile out of its shared sheet image. The sheet loads once —
 *  `expo-image`'s cache keys on `sheetUrl`, so every tile cut from the same sheet reuses one
 *  request — scaled so the tile matches `width`, then offset so only its `{x,y,w,h}` rect shows
 *  through the tile's `overflow: hidden` bounds (`styles.thumb`). Same idea as a CSS sprite: plain
 *  View/Image layout math, so it renders identically on web, iOS, and Android with no SVG or
 *  native region-decoding needed. */
function SpriteCrop({ thumb, width, onLoad }: { thumb: SpriteThumb; width: number; onLoad?: () => void }) {
  const scale = width / thumb.w;
  return (
    <Image
      source={{ uri: thumb.sheetUrl }}
      style={{
        position: 'absolute',
        width: thumb.sheetWidth * scale,
        height: thumb.sheetHeight * scale,
        left: -thumb.x * scale,
        top: -thumb.y * scale,
      }}
      contentFit="fill"
      cachePolicy="memory-disk"
      transition={200}
      onLoad={onLoad}
    />
  );
}

/** A gentle vertical transparent→`color` fade over the last rows; only the very
 *  bottom reaches solid (where it meets the page background), so the button
 *  floats over the still-visible, fading thumbnails rather than a solid block. */
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
  head: {
    gap: Spacing.two,
  },
  headTitle: {
    // Reference .chapters-head h3: 1.15rem (~18px).
    fontSize: 18,
    lineHeight: 24,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tabs: {
    // Fill the row so the tab buttons span the full width and push the sort
    // button hard against the right edge.
    flex: 1,
    flexDirection: 'row',
    borderRadius: 10,
    padding: TAB_PAD,
    gap: TAB_GAP,
  },
  // Sliding highlight behind the active tab (see `pillStyle`) — positioned
  // relative to the strip's own padding edge, same origin as the tab Pressables.
  tabPill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 8,
  },
  tab: {
    // Each tab takes an equal slice of the group's width, label centred.
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    borderRadius: 8,
  },
  tabLabel: {
    // Reference .ch-tab: 0.82rem (~13px).
    fontSize: 13,
    textAlign: 'center',
  },
  sortBtn: {
    width: 36,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
  thumbGridWrap: {
    position: 'relative',
  },
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  moreOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Button sits at the bottom of the cards, within the short fade.
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: Spacing.three,
  },
  showMore: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  thumb: {
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
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
