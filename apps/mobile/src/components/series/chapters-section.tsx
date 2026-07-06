import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isAbort, resolveAssetSourceCached } from '@/data/api';
import { coverDelayMs, relativeTime } from '@/data/mock';
import { useDataSource } from '@/data/source';
import type { Chapter, PageThumbSource, SpriteThumb } from '@/data/types';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT, usePrefetchedImage } from '@/lib/aspect-ratio';
import { compareChapters } from '@/lib/chapter-order';
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
// How much smaller the sliding highlight is than the tab it sits behind —
// horizontally and vertically separately, since the vertical inset wants to
// read as more of a floating capsule than the horizontal one. This is what
// makes it a bubble rather than a block filling its slot edge-to-edge.
const PILL_INSET_X = 3;
const PILL_INSET_Y = 6;

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

  // Sliding highlight behind the active tab — each tab is sized to its own
  // label (not an equal slice of the strip), so the highlight has to be
  // measured per-tab rather than computed from a shared segment width.
  const [tabLayouts, setTabLayouts] = useState<Partial<Record<Tab, { x: number; width: number }>>>({});
  const onTabLayout = (id: Tab, x: number, width: number) => {
    setTabLayouts((prev) => (prev[id]?.x === x && prev[id]?.width === width ? prev : { ...prev, [id]: { x, width } }));
  };
  const activeBox = tabLayouts[tab];
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillMeasured = useRef(false);
  useEffect(() => {
    if (!activeBox) return;
    const x = activeBox.x + PILL_INSET_X;
    const width = activeBox.width - PILL_INSET_X * 2;
    // Snap into place on first measurement (no slide-in from 0); morph width
    // and position together for every change after that — no spring/bounce,
    // just the bubble smoothly resizing and sliding to hug the new label.
    if (!pillMeasured.current) {
      pillX.value = x;
      pillWidth.value = width;
      pillMeasured.current = true;
    } else {
      const config = { duration: 220, easing: Easing.out(Easing.cubic) };
      pillX.value = withTiming(x, config);
      pillWidth.value = withTiming(width, config);
    }
  }, [activeBox, pillX, pillWidth]);
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillWidth.value,
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
          <ThemedView type="backgroundElement" style={styles.tabs}>
            {activeBox && (
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
                onLayout={(e) => onTabLayout(t.id, e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
                style={styles.tab}>
                <ThemedText
                  type="small"
                  numberOfLines={1}
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
// Once expanded, further rows stream in this many at a time as the sentinel
// nears the viewport, instead of mounting the whole (possibly 300+ tile) set.
const BATCH_ROWS = 4;
// How far below the viewport's bottom edge the sentinel can be and still
// trigger the next batch — enough lead time that the next row is ready before
// the user actually scrolls to it.
const SENTINEL_MARGIN = 400;
// How often to re-check the sentinel's on-screen position. RN has no native
// IntersectionObserver, so this polls instead of subscribing to the ancestor
// ScrollView's scroll events — the grid lives inside the series screen's own
// ScrollView, and a vertical FlatList can't be nested inside one.
const SENTINEL_POLL_MS = 250;

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
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [containerW, setContainerW] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const cols = screenW >= 900 ? 5 : screenW >= 600 ? 3 : 2;
  const gap = Spacing.two;
  const tileW = containerW > 0 ? (containerW - gap * (cols - 1)) / cols : 0;

  // Past a few rows, collapse: a gradient fades the last visible rows out under
  // a centered "Show all" button so it reads as "there's more". Mirrors the
  // reference's `.page-thumbs-more`.
  const collapsedCount = cols * COLLAPSED_ROWS;
  const batchSize = cols * BATCH_ROWS;
  const collapsed = !expanded && thumbs.length > collapsedCount;
  const visibleCount = expanded ? Math.min(collapsedCount + revealedCount, thumbs.length) : collapsedCount;
  const shown = thumbs.slice(0, visibleCount);
  const hasMore = expanded && visibleCount < thumbs.length;
  const fadeHeight = tileW > 0 ? Math.round(tileW * (3 / 2) * 0.6) : 120;

  // Grow the revealed count in batches as the sentinel below the grid nears
  // the viewport, so "Show all" on a 300-page series streams tiles (and their
  // thumbnail fetches) in progressively rather than mounting all of them at
  // once.
  const sentinelRef = useRef<View>(null);
  useEffect(() => {
    if (!hasMore) return;
    let cancelled = false;
    let pending = false;
    const check = () => {
      if (cancelled || pending) return;
      const node = sentinelRef.current;
      if (!node) return;
      pending = true;
      node.measureInWindow((_x, y) => {
        pending = false;
        if (!cancelled && y < screenH + SENTINEL_MARGIN) {
          setRevealedCount((c) => c + batchSize);
        }
      });
    };
    check();
    const id = setInterval(check, SENTINEL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hasMore, screenH, batchSize]);

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
          {hasMore && tileW > 0 && (
            <View ref={sentinelRef} style={{ width: tileW, height: 1, pointerEvents: 'none' }} />
          )}
        </View>

        {collapsed && (
          <View style={[styles.moreOverlay, { height: fadeHeight, pointerEvents: 'box-none' }]}>
            <GradientFade color={theme.background} />
            <Pressable
              onPress={() => {
                setExpanded(true);
                setRevealedCount(batchSize);
              }}
              hitSlop={8}>
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
  // neighbouring sheet pixels). A plain `image` tile's shape isn't known
  // until it's fetched, so its aspect ratio is resolved off-screen first (see
  // `usePrefetchedImage`) and the tile only mounts once that's settled, so it
  // never pops in at the default size and shrinks a moment later — the
  // prefetched `ref` is then reused as the visible image's source, so this
  // doesn't cost a second network request. Either way, `thumbShell` below
  // stays the constant default-shape slot regardless, so a shorter/taller
  // tile never reflows its row.
  const imageUrl = resolved?.kind === 'image' ? resolved.url : null;
  // Resolve the (possibly server-relative / embedded-transport) image URL through the transport
  // first — the same lazy resolution `SpriteCrop` does for its sheet — then prefetch *that* resolved
  // URL's dimensions off-screen. Prefetching the raw URL would skip embedded-mode asset resolution
  // and fail to load. Empty string for a sprite tile resolves synchronously to '' and is never used.
  const resolvedImageUrl = useResolvedThumbUrl(imageUrl ?? '', (msg) =>
    logDiagnostic('page-thumb-image', msg, {
      url: imageUrl ?? '',
      context: `bridge=${bridgeId ?? ''} series=${seed} page=${index}`,
    }),
  );
  const image = usePrefetchedImage(imageUrl ? resolvedImageUrl : null, delayPassed);
  const dimsReady = resolved?.kind === 'sprite' || image.settled;
  const aspectRatio = resolved?.kind === 'sprite' ? clampThumbAspect(resolved.w / resolved.h) : image.aspect;
  const ready = delayPassed && dimsReady && loaded;

  return (
    <Pressable style={[styles.thumbShell, { width }]} onPress={onPress}>
      <View style={[styles.thumb, { aspectRatio }]}>
        {delayPassed && dimsReady && resolved?.kind === 'image' && (
          <Image
            source={image.ref ?? { uri: resolvedImageUrl || resolved.url }}
            style={styles.thumbImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
            onLoad={() => setLoaded(true)}
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
        <View style={styles.pageNum}>
          <ThemedText style={styles.pageNumText}>{page}</ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

/** Crops a `sprite`-kind thumbnail's tile out of its shared sheet image. The sheet loads once —
 *  `expo-image`'s cache keys on `sheetUrl`, so every tile cut from the same sheet reuses one
 *  request — scaled so the tile matches `width`, then offset so only its `{x,y,w,h}` rect shows
 *  through the tile's `overflow: hidden` bounds (`styles.thumb`). Same idea as a CSS sprite: plain
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
    // Content-sized (not `flex: 1` on each child) — a tab's width follows its
    // own label, so "All" and "Overview" don't get forced to the same width.
    // Fixed height (matching the sort button) rather than letting padding
    // drive it, so the whole controls row reads as one consistent height.
    flex: 1,
    height: CONTROLS_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: TAB_PAD,
    gap: TAB_GAP,
  },
  // Sliding highlight behind the active tab (see `pillStyle`) — inset from the
  // active tab's own measured box (see `onTabLayout`/`activeBox`) so it reads
  // as a floating bubble rather than a block filling its tab edge-to-edge.
  // Height is static (every tab shares the same height) — inset vertically
  // here; x/width (horizontal inset baked in) animate in `pillStyle`.
  tabPill: {
    position: 'absolute',
    top: PILL_INSET_Y,
    bottom: PILL_INSET_Y,
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
  sortBtn: {
    width: 36,
    height: CONTROLS_HEIGHT,
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
    // Without this, flexbox's default cross-axis `stretch` forces every tile
    // in a wrapped row to the row's tallest tile — since each tile's own chrome
    // (rounded corners, clipping) lives directly on the flex item here (unlike
    // the series card, where that chrome sits on an inner child), stretching
    // visibly distorts the box itself instead of just padding empty space.
    alignItems: 'flex-start',
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
  thumbShell: {
    // Constant slot — always the default 2:3 shape, the vertical max a tile
    // can occupy. Never resizes, so a tile's row never reflows.
    aspectRatio: DEFAULT_THUMB_ASPECT,
  },
  thumb: {
    width: '100%',
    position: 'relative',
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
