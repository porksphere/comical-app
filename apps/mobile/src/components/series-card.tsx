import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type View as ViewType, type ViewStyle } from 'react-native';
import Animated, { Easing, type AnimatedStyle, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { CardBadge, UnreadBadge } from '@/components/card-badge';
import { SeriesCardMenu } from '@/components/series-card-menu';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { coverDelayMs } from '@/data/mock';
import type { SeriesEntry } from '@/data/types';
import { useIsCompact } from '@/hooks/use-responsive';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';
import { ASPECT_TRANSITION_MS, clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { encodeSeriesParam, useDrillRelatedSeries } from '@/lib/series-nav';
import { Link, router } from '@/lib/nav';
import { useLightCards } from '@/lib/perf-flags';
import { newZoomSourceKey, setZoomOrigin, useIsZoomingSeries } from '@/lib/series-zoom';
import { testId } from '@/lib/test-id';

// Shared cover card used by both the browse grid and the rails. `size` picks the
// fixed rail widths; `grid` fills its parent slot (the grid controls columns).
// Mirrors `.card` in the reference: a chrome-less cover (2:3, radius 10) that
// shows a highlight ring only on hover (web) or while held (touch), overlaid
// badges, and a clamped title that reveals in full while active.

export type CardSize = 'grid' | 'rail' | 'ranked' | 'hero';

// Cross-instance cache of covers that have already resolved at least once this session.
// Recycled list cells reset their component-local `loaded`/`delayPassed`/`coverAspect` state on
// every entry-id change (see the recycle-safety block below) — correct for genuinely per-item
// state like the held-highlight or truncation flag, but it was ALSO replaying the skeleton (and,
// in mock mode, the whole simulated network delay) for entries that had already loaded moments
// earlier, e.g. scrolling back up over rows already seen — even though the real image is already
// sitting in expo-image's own memory-disk cache. These two maps mirror that "already resolved"
// fact across recycles so a revisit skips straight to the settled state. Module-level and
// session-lifetime only (cleared on reload) — same lifetime as expo-image's own cache.
const resolvedCoverIds = new Set<string>();
const resolvedCoverAspects = new Map<string, number>();

// Rolling "last resolved" aspect ratio, updated every time any cover resolves (see onLoad
// below). Covers tend to cluster by shape — series uploaded back-to-back, or just runs of
// same-shaped thumbnails — so for an entry seen for the first time this session, this is a
// cheap, decent guess at its real shape, used as the initial/recycle seed below instead of
// the flat placeholder. A closer seed means a smaller (or zero) shrink-illusion delta in
// onLoad, i.e. fewer/less-drastic visible resizes. Deliberately a single rolling scalar, not
// a real nearest-by-list-position lookup — no `index` prop reaches this component from the
// main grid call sites, and list/scroll order already correlates with resolve order closely
// enough that the extra complexity of a position-indexed cache isn't worth it.
let lastResolvedCoverAspect = DEFAULT_THUMB_ASPECT;

const WIDTHS: Record<Exclude<CardSize, 'grid'>, number> = {
  rail: 130,
  ranked: 150,
  hero: 240,
};

// Reference: `.clampable > span { -webkit-line-clamp: 3; }` — clamps to 3
// lines before the full-title peek popover takes over, not 2.
const MAX_TITLE_LINES = 3;
// Card title metrics mirror the reference's `.card-title`: 0.85rem desktop /
// 0.8rem mobile (1rem = 16px), line-height 1.3 (rounded to whole px).
const TITLE_FONT_SIZE = { regular: 13.6, compact: 12.8 };
const TITLE_LINE_HEIGHT = { regular: 18, compact: 17 };
// Subtitle (author / latest chapter) mirrors `.card-sub`: 0.75rem desktop /
// 0.72rem mobile, line-height ~1.3, color #888 (here: the theme's muted text).
const SUB_FONT_SIZE = { regular: 12, compact: 11.5 };
const SUB_LINE_HEIGHT = { regular: 16, compact: 15 };

// Large enough to cover any screen: the press stays "active" wherever the finger
// goes, so the highlight only ends on release.
const HOLD_RETENTION = { top: 1000, bottom: 1000, left: 1000, right: 1000 };

/**
 * Predicted card height for a given column width, in the worst case of a 3-line title — fed to the
 * grids' `estimatedItemSize` so LegendList can size unmeasured rows without a first-paint layout
 * pass. Mirrors `styles.card`'s `gap` (Spacing.two, 8px, between every child) and `styles.sub`'s
 * `marginTop: -5` (title→sub net gap is therefore 8 - 5 = 3px).
 *
 * `hasSub` is whether this surface's entries carry a subtitle line — the bridge's `cardSubtitles`
 * contract flag (see `useBridgeMap().subOf`), or `true` for surfaces that make their own subs (the
 * Library's bridge-name line). Bridges that never send one drop the reserve entirely, which is what
 * keeps sub-less rows from carrying a permanent blank band under every card.
 *
 * A hint, not an exact match — real cards vary with cover aspect (`fillFactor` backfills the
 * difference) and title line count, so this doesn't need to be exact.
 */
export function estimatedCardHeight(cardWidth: number, hasSub: boolean): number {
  const coverHeight = cardWidth / DEFAULT_THUMB_ASPECT;
  const titleHeight = MAX_TITLE_LINES * TITLE_LINE_HEIGHT.regular;
  const base = coverHeight + Spacing.two + titleHeight;
  if (!hasSub) return base;
  const titleToSubGap = Spacing.two - 5;
  return base + titleToSubGap + SUB_LINE_HEIGHT.regular;
}

/**
 * Held-highlight state. A press/touch "holds" the card active; on the web the
 * hold is only released by an actual pointer/touch *release* anywhere on the
 * page — moving the finger or scrolling does NOT end it (a scroll isn't a
 * finger-up). Mouse hover holds it too. Native falls back to press in/out with a
 * large press-retention offset so sliding off the card keeps it active.
 */
function useHeld() {
  const [held, setHeld] = useState(false);
  const [hovered, setHovered] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);

  const start = useCallback(() => {
    setHeld(true);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      cleanup.current?.();
      const release = () => {
        setHeld(false);
        window.removeEventListener('pointerup', release);
        window.removeEventListener('touchend', release);
        window.removeEventListener('mouseup', release);
        cleanup.current = null;
      };
      // Only true finger/mouse releases end the hold — deliberately NOT
      // pointercancel/touchcancel, so a scroll keeps the card highlighted.
      window.addEventListener('pointerup', release);
      window.addEventListener('touchend', release);
      window.addEventListener('mouseup', release);
      cleanup.current = release;
    }
  }, []);

  const end = useCallback(() => {
    // On the web the global release listener owns teardown; on native, press-out
    // is the release.
    if (Platform.OS !== 'web') setHeld(false);
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  // Clear the held/hovered state — called when this card instance is recycled to
  // a different entry (see SeriesCard's per-item reset) so a card reused mid-press
  // doesn't carry the previous slot's highlight.
  const reset = useCallback(() => {
    setHeld(false);
    setHovered(false);
    cleanup.current?.();
  }, []);

  return {
    active: held || hovered,
    handlers: {
      onPressIn: start,
      onPressOut: end,
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
    },
    reset,
  };
}

/**
 * The FLIP-style cover-aspect "shrink" illusion, extracted into its own component so its reanimated
 * hooks (4 shared values + 2 animated styles) are only allocated when it's actually used. SeriesCard
 * mounts this (via render-prop) only when `lightCards` is off; when on, it passes a no-op API so a
 * scrolling grid of cards pays nothing for the shrink machinery.
 *
 * Animating `aspectRatio` (a layout prop) would relayout every frame; instead the box's aspect is
 * committed instantly and these transform-only styles fake the settle: the picture layer scales down
 * from its old apparent size, and the text below translates up to catch it.
 */
type ShrinkApi = {
  pictureStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  trailingStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  onCoverLayout?: (e: LayoutChangeEvent) => void;
  /** Kick off the settle from the old aspect to the new one (called from the cover's onLoad). */
  runShrink?: (oldAspect: number, newAspect: number) => void;
};

const NOOP_SHRINK: ShrinkApi = {};

function CoverShrink({ entryId, children }: { entryId: string; children: (api: ShrinkApi) => React.ReactNode }) {
  const coverBoxWidthSV = useSharedValue(0);
  const shrinkProgressSV = useSharedValue(1); // 1 = settled; animates 0 -> 1 per transition
  const shrinkFromScaleSV = useSharedValue(1); // picture's scaleY at progress 0
  const shrinkFromOffsetSV = useSharedValue(0); // trailing group's translateY (px) at progress 0
  // Reset to rest when this instance is recycled to a different entry (effect, not render — writing a
  // shared value during render trips reanimated's strict-mode warning).
  useEffect(() => {
    shrinkProgressSV.set(1);
    shrinkFromScaleSV.set(1);
    shrinkFromOffsetSV.set(0);
  }, [entryId, shrinkProgressSV, shrinkFromScaleSV, shrinkFromOffsetSV]);
  const pictureStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: shrinkFromScaleSV.value + (1 - shrinkFromScaleSV.value) * shrinkProgressSV.value }],
  }));
  const trailingStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: shrinkFromOffsetSV.value * (1 - shrinkProgressSV.value) }],
  }));
  const onCoverLayout = useCallback(
    (e: LayoutChangeEvent) => {
      coverBoxWidthSV.set(e.nativeEvent.layout.width);
    },
    [coverBoxWidthSV],
  );
  const runShrink = useCallback(
    (oldAspect: number, newAspect: number) => {
      // width cancels out of the scale factor but not the pixel offset, so it must be known first.
      const width = coverBoxWidthSV.value;
      if (width > 0 && newAspect !== oldAspect) {
        const oldHeight = width / oldAspect;
        const newHeight = width / newAspect;
        shrinkFromScaleSV.set(newHeight > 0 ? oldHeight / newHeight : 1);
        shrinkFromOffsetSV.set(oldHeight - newHeight);
        shrinkProgressSV.set(0);
        shrinkProgressSV.set(withTiming(1, { duration: ASPECT_TRANSITION_MS, easing: Easing.out(Easing.cubic) }));
      }
    },
    [coverBoxWidthSV, shrinkFromScaleSV, shrinkFromOffsetSV, shrinkProgressSV],
  );
  return <>{children({ pictureStyle, trailingStyle, onCoverLayout, runShrink })}</>;
}

export function SeriesCard({
  entry,
  size = 'grid',
  rank,
  width,
  index = 0,
  onPeekChange,
  bridge,
  bridgeId,
  direct,
  cohort,
  crossfading,
}: {
  entry: SeriesEntry;
  size?: CardSize;
  rank?: number;
  /** Explicit card width (rails compute a responsive one); falls back to the
   *  per-size default. `grid` cards ignore this and fill their column. */
  width?: number;
  /** Card position in its rail — used by the rail to place the lifted popover. */
  index?: number;
  /** When provided (rail mode), the card reports its peek state up instead of
   *  drawing its own popover, so the rail can render it OUTSIDE the clipping
   *  horizontal scroller. The grid omits this and draws the popover in-card. */
  onPeekChange?: (show: boolean, index: number) => void;
  /** Originating bridge name, carried to the series detail's header. */
  bridge?: string;
  /** Originating bridge's stable id, carried so the series detail can call the
   *  real API. Absent in mock mode, where there's no real id to fetch with. */
  bridgeId?: string;
  /** Whether the bridge serves "direct" series (page thumbnails, no chapters);
   *  carried to the detail so it renders the page grid instead of a chapter list. */
  direct?: boolean;
  /** The card's content cohort (the browse grid passes its `gridScope`). When this changes
   *  between two entries handed to the SAME recycled instance, the swap is a scope change (bridge /
   *  page / filter / search), not an in-scope scroll — see the recycle-safety block, which then
   *  forces the skeleton back on to mask the stale cover until the new one loads, instead of taking
   *  the `resolvedCoverIds` fast-path. Omitted by call sites whose cards don't recycle across
   *  scopes (rails remount per section, HomeGridBlock, Library/History), where today's behavior is
   *  already correct. */
  cohort?: string;
  /** True while the whole home is mid bridge-switch crossfade. A cohort swap that lands here happens
   *  at opacity 0 (the crossfade hides it), so there's NO stale cover to mask — skip the forced
   *  skeleton and take the `resolvedCoverIds` fast-path, so a cached cover paints immediately on
   *  reveal instead of a needless skeleton-then-cover. A non-crossfaded swap (within-bridge recycle)
   *  still masks. */
  crossfading?: boolean;
}) {
  // Perf toggle (Settings → "Lightweight cards") — see lib/perf-flags.
  const lightCards = useLightCards();
  // Inside the series page's OWN stack (related rails, its nested search results), the card
  // drills the series in as an ordinary pushed card instead of stacking a second transparent
  // modal — see useDrillRelatedSeries. Context + navigation reads only — cards don't re-render
  // on every navigation the way a pathname hook would make them.
  const drillRelated = useDrillRelatedSeries();
  const [loaded, setLoaded] = useState(() => resolvedCoverIds.has(entry.id));
  const [truncated, setTruncated] = useState(false);
  // True while masking a scope swap (see the recycle-safety block): the shared `Skeleton` is only
  // ~18% opaque, which reads fine over an empty cover box on a fresh load but does NOT hide a
  // lingering *old* cover — expo-image reuses the recycled <img> and (on web) doesn't clear the
  // previous bitmap synchronously on a recyclingKey change, so it shows straight through the
  // translucent skeleton until the new source decodes. On a swap we drop an OPAQUE backing behind
  // the skeleton to actually cover it; fresh mounts (no stale bitmap) leave the subtle look untouched.
  const [maskStale, setMaskStale] = useState(false);
  const theme = useTheme();
  // The cover's real (capped) aspect ratio — a plain, UNanimated value. Since
  // `clampThumbAspect` only ever returns >= DEFAULT_THUMB_ASPECT, the box only ever
  // shrinks from its default placeholder height (never grows past it), so setting
  // this is always a single, one-time relayout — no cheaper way to know a cover's
  // shape than to just let that relayout happen once. What's smoothed below is the
  // *visual* shrink, via a `transform`-only illusion that never triggers another
  // relayout — see `pictureStyle`/`trailingStyle`. Seeded from `resolvedCoverAspects`
  // when this id has already resolved before (revisit renders at its real shape
  // immediately), else from the rolling `lastResolvedCoverAspect` guess (see above)
  // rather than the flat placeholder.
  const [coverAspect, setCoverAspect] = useState(
    () => resolvedCoverAspects.get(entry.id) ?? lastResolvedCoverAspect
  );
  // The FLIP-style cover-aspect shrink illusion lives in `CoverShrink` (rendered only when its
  // effects are wanted — see the render below), so its reanimated hooks aren't allocated per card
  // when Lightweight cards is on.
  const { active, handlers, reset: resetHeld } = useHeld();
  // Resolve the cover the same way the reader resolves page images: absolute URLs pass through,
  // a server-relative `/img-proxy` cover (from a Referer-gated source) is routed to the API
  // base on web / the in-process transport on device. Without this those covers render blank.
  const resolvedCover = useResolvedAsset(entry.cover);
  const fixedWidth = size === 'grid' ? undefined : (width ?? WIDTHS[size]);
  // The active/held decorations differ by platform: web keeps the hover highlight ring + full-title
  // peek popover; iOS/Android drop both (the OS-native long-press context menu is the affordance
  // there, and its own lifted preview would fight an inline ring/popover) in favor of a subtle
  // non-scaling held scrim on the cover — see the ring/peek/scrim below.
  const isWeb = Platform.OS === 'web';

  // This card's COVER box, in window coordinates, handed to
  // the series page so the page can grow out of it — see lib/series-zoom. The cover, not the whole
  // card: the page's arriving frame is matched to this rect exactly, and matching the card
  // (cover + title + sub) would have it overlap the title text and crop the cover differently than
  // the card does. Measured off the box itself rather than derived from `coverAspect`, so it's
  // right no matter which aspect the card happens to be showing at press time.
  //
  // Taken on press-IN, not press: `measureInWindow` answers asynchronously, so measuring at press
  // would put a native round trip in front of the navigation. A drill (a related-rail card inside
  // the series page) captures too — those layers zoom exactly like a top-level open. Web has no
  // zoom entrance, so it doesn't measure at all.
  // While a zoom this card is the SOURCE of is in the air it flies a COPY of this cover, so the
  // original blanks — same treatment (and same reason) as the long-press menu's lifted preview
  // below. A selector read: the whole grid subscribes, only the one card whose flag flips renders.
  //
  // Keyed to this card, not to the series: the same series can be showing somewhere else at the
  // same time (most obviously in a search LAYER opened from its own page), and those copies are
  // not what the page collapses into — see newZoomSourceKey. Per INSTANCE, so a recycled card
  // carries its key across entries; the id is compared alongside it.
  const [zoomSource] = useState(newZoomSourceKey);
  const zoomFlying = useIsZoomingSeries(entry.id, zoomSource);
  const coverRef = useRef<ViewType>(null);
  const captureZoomOrigin = useCallback(() => {
    if (isWeb) return;
    coverRef.current?.measureInWindow((x, y, w, h) => {
      // CARD_COVER_RADIUS, matching `coverBoxClip` / `coverClip` below.
      if (w > 0 && h > 0) setZoomOrigin(entry.id, zoomSource, { x, y, width: w, height: h, radius: 10 });
    });
  }, [isWeb, entry.id, zoomSource]);

  // The quick-actions menu is only offered when there's a real bridge to act against (`bridgeId` —
  // absent in mock mode). Its status queries no longer touch the card at all: they run inside the
  // shared `SeriesActionsMenu`, which only mounts while the menu is open (native long-press / web
  // 3-dot), so a scrolling grid pays nothing for them. See `series-card-menu.tsx`.
  const menuEnabled = !!bridgeId;

  // Recycle-safety: the browse grid and rails now reuse card instances
  // (recycleItems), so when a slot is handed a different entry this same
  // component re-renders with new props instead of remounting. Reset the
  // per-item state that would otherwise linger from the previous entry —
  // synchronously, during render (React's "adjust state on prop change"
  // pattern), so not one frame shows the old cover-loaded/truncation state.
  // This works identically when the card is genuinely remounted (the ref starts
  // equal to entry.id, so it's a no-op) and in the non-recycled call sites
  // (HomeGridBlock, the wide rail grid). `coverAspect` resets here too so a reused
  // slot doesn't keep the prior cover's shape — and the shrink illusion resets to
  // its settled (no-offset) values right alongside it, so a recycled slot showing a
  // DIFFERENT entry snaps back to the placeholder shape instantly rather than
  // visibly morphing from the previous entry's shape (only a genuine onLoad,
  // further down, sets the illusion in motion). `delayPassed` is already true in
  // real mode.
  const prevIdRef = useRef(entry.id);
  const prevCohortRef = useRef(cohort);
  if (prevIdRef.current !== entry.id) {
    prevIdRef.current = entry.id;
    // A recycle that ALSO crosses a cohort boundary is a scope swap (bridge/page/filter/search),
    // where this instance is still painting the previous scope's cover — so force the skeleton on
    // (loaded=false) to mask it until the new cover's own onLoad fires, no matter how long that
    // takes (event-driven, never a timer — a slow swap keeps the skeleton the whole time). A plain
    // in-scope scroll recycle (cohort unchanged) keeps the `resolvedCoverIds` fast-path, so
    // scrolling over already-seen rows still doesn't replay the skeleton. `prevCohortRef` only
    // advances here, on an entry change, so a cohort switch that lands a frame BEFORE its new items
    // (keepPreviousData still showing the old scope) is still detected when the items finally swap.
    // A cohort swap normally means a stale cover is on screen to mask — UNLESS it's happening under
    // the home crossfade (bridge switch), where the swap is hidden at opacity 0 and there's nothing
    // to hide. In that case take the fast-path so a cached cover paints on reveal (see `crossfading`).
    const maskSwap = prevCohortRef.current !== cohort && !crossfading;
    prevCohortRef.current = cohort;
    setLoaded(maskSwap ? false : resolvedCoverIds.has(entry.id));
    // Opaque mask only on a masked swap (there's a stale bitmap to hide); a plain scroll recycle (or
    // a crossfaded swap) clears it so already-seen rows keep the subtle skeleton, or none at all.
    setMaskStale(maskSwap);
    setTruncated(false);
    setCoverAspect(resolvedCoverAspects.get(entry.id) ?? lastResolvedCoverAspect);
    resetHeld();
  }

  // Responsive title size matching the reference's mobile/desktop type scale.
  const compact = useIsCompact();
  const titleFontSize = compact ? TITLE_FONT_SIZE.compact : TITLE_FONT_SIZE.regular;
  const titleLineHeight = compact ? TITLE_LINE_HEIGHT.compact : TITLE_LINE_HEIGHT.regular;
  const titleSize = { fontSize: titleFontSize, lineHeight: titleLineHeight };

  // Hold some covers behind a simulated network delay: we don't even mount the
  // <Image> until the delay elapses, so the skeleton stays visible (a stand-in
  // for real bridge image latency). Most covers are instant.
  // `coverDelayMs` self-gates on mock mode (0 in real mode), so real covers get no fake latency.
  // Already-resolved ids (see `resolvedCoverIds`) also skip the delay on a revisit — a recycle
  // shouldn't re-simulate network latency for a cover it's already shown once this session.
  const delay = useMemo(
    () => (resolvedCoverIds.has(entry.id) ? 0 : coverDelayMs(entry.id)),
    [entry.id],
  );
  const [delayPassed, setDelayPassed] = useState(delay === 0);
  useEffect(() => {
    // Assert delayPassed=true on no delay rather than early-returning, so a delay/key change can't
    // strand it false after its pending timeout was cleared (matches PageThumb/ReaderPage).
    if (delay === 0) {
      setDelayPassed(true);
      return;
    }
    setDelayPassed(false);
    setLoaded(false);
    const t = setTimeout(() => setDelayPassed(true), delay);
    return () => clearTimeout(t);
  }, [delay, entry.id]);

  // The cover's real (capped) aspect ratio, learned from the visible <Image>'s
  // own `onLoad` (`event.source.width/height`) rather than an off-screen
  // `Image.loadAsync` prefetch. The prefetch made the box the right shape one
  // frame earlier, but at a real cost: a second decode kept in state PER card
  // plus an extra re-render per card — across a grid + every related rail that's
  // a burst of JS work and held decoded images (memory → GC) that showed up as
  // the ~400ms main-thread stalls. The card is fixed-height (see `fillFactor` /
  // `coverFill`), so the cover box adjusting its aspect on load doesn't reflow
  // the row — it just settles the cover within a stable card.
  const coverReady = delayPassed && loaded;

  // The cover top-aligns at its real (capped) aspect ratio and the title sits
  // right under it. To keep every card the SAME height regardless of cover shape
  // — so rows and rails never reflow as covers finish loading — pad the BOTTOM of
  // the card (below the title/sub) with a spacer that fills exactly the height a
  // wider-than-2:3 cover falls short of the 2:3 maximum. `fillFactor` is that
  // deficit as a fraction of the card's width (0 for a full 2:3 cover); the
  // spacer expresses it as an `aspectRatio` so it scales with the width without
  // measuring it (works for both the flex grid and the fixed-width rails). The
  // cover shrinks and this grows by the same amount, so the total never jumps
  // when the cover's real aspect lands from onLoad.
  const fillFactor = 1 / DEFAULT_THUMB_ASPECT - 1 / coverAspect;

  // Full-title peek. In a rail, hand the show/hide up to the rail (it owns the
  // un-clipped popover); in the grid, render it in-card (the vertical list
  // doesn't clip downward overflow). Web only — on native the full title is shown
  // by the long-press context menu instead (see SeriesCardMenu's `title`).
  const showPeek = active && truncated && isWeb;
  const onPeekRef = useRef(onPeekChange);
  onPeekRef.current = onPeekChange;
  useEffect(() => {
    onPeekRef.current?.(showPeek, index);
  }, [showPeek, index]);
  // Stop reporting if the card unmounts while peeking (rail recycle/scroll).
  useEffect(() => () => onPeekRef.current?.(false, index), [index]);

  // Matched the user's persistent tag/genre exclusions: a redacted, non-tappable
  // placeholder that keeps the slot (grid counts/columns stay stable) but never
  // even requests the real cover/title — mirrors the reference's `makeCard`
  // (app.ts:2649), which renders excluded entries without touching their image.
  if (entry.excluded) {
    return (
      <View style={StyleSheet.flatten([styles.card, fixedWidth != null && { width: fixedWidth }])}>
        <View style={[styles.coverBox, { aspectRatio: DEFAULT_THUMB_ASPECT }]}>
          <View style={[styles.coverClip, styles.hiddenCover]}>
            <ThemedText type="small" themeColor="textSecondary">
              Hidden
            </ThemedText>
          </View>
        </View>
      </View>
    );
  }

  // The card's cover + trailing content, parameterized by the shrink-illusion API. Rendered plainly
  // (no-op API) when Lightweight cards is on, or wrapped in <CoverShrink> (which supplies real
  // animated styles) when off — so the shrink hooks are only paid for when actually animating.
  const renderCardBody = (shrink: ShrinkApi, coverHidden: boolean) => {
    // The picture layer (image + skeleton/mask). Only the shrink illusion needs it wrapped in a
    // scalable Animated.View; the lightweight (non-animated) path renders these straight into the
    // clip box, dropping both a host view AND a Reanimated wrapper per card in the common case.
    const pictureInner = (
      <>
        {delayPassed && (
          <Image
            source={{ uri: resolvedCover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={lightCards ? 0 : 90}
            // Recycled lists reuse this <Image> instance for a different entry; without a
            // recyclingKey expo-image keeps painting the PREVIOUS cover until the new one decodes.
            recyclingKey={entry.id}
            onLoad={(e) => {
              resolvedCoverIds.add(entry.id);
              const src = e.source;
              if (src?.width && src?.height) {
                const nextAspect = clampThumbAspect(src.width / src.height);
                resolvedCoverAspects.set(entry.id, nextAspect);
                lastResolvedCoverAspect = nextAspect;
                // Smooth the aspect settle when the shape changes; no-op when Lightweight is on.
                shrink.runShrink?.(coverAspect, nextAspect);
                // Only relayout when the real shape differs meaningfully from the seeded guess.
                // Covers cluster by shape, so the rolling seed is usually within epsilon — skipping
                // this avoids a Fabric commit per cover during scroll (the dominant completeRoot cost).
                if (Math.abs(nextAspect - coverAspect) > 0.02) setCoverAspect(nextAspect);
              }
              // Light path: the clip's own grey backing IS the placeholder, and expo-image paints the
              // decoded cover over it natively — so no `loaded` state flip (hence no per-cover commit)
              // is needed just to hide a skeleton. Non-light shows the pulsing Skeleton, which must be
              // hidden via state. Either way, an active stale-swap mask (rare) still needs clearing.
              if (!lightCards) setLoaded(true);
              if (maskStale) setMaskStale(false);
            }}
          />
        )}
        {!coverReady && maskStale && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement }]} />
        )}
        {/* Non-light shows a pulsing skeleton while loading; the light path relies on the clip's grey
            backing (above) so a loaded cover reveals natively with no commit. */}
        {!coverReady && !lightCards && <Skeleton style={StyleSheet.absoluteFill} />}
      </>
    );

    // Title + sub + bottom filler. On native the title needs no wrapper — the relative-positioned
    // `titleWrap` exists only for web's measured-clamp copy + in-card peek popover (both web-only),
    // so bare-rendering it drops another host view per card on the platform that scrolls these grids.
    const titleText = (
      <ThemedText type="small" numberOfLines={MAX_TITLE_LINES} style={[styles.title, titleSize]}>
        {entry.title}
      </ThemedText>
    );
    const trailingInner = (
      <>
        {isWeb ? (
          <View style={styles.titleWrap}>
            {titleText}
            {/* Off-screen full-height copy measured to detect clamping — WEB ONLY (only drives the
                hover peek popover; on native it was a wasted per-card text layout + re-render). */}
            <ThemedText
              type="small"
              style={[styles.title, titleSize, styles.measure]}
              onLayout={(e) =>
                setTruncated(e.nativeEvent.layout.height > MAX_TITLE_LINES * titleLineHeight + 1)
              }>
              {entry.title}
            </ThemedText>
            {/* Grid-only in-card popover (rails render it at the rail level). */}
            {!onPeekChange && showPeek && <TitlePeek title={entry.title} />}
          </View>
        ) : (
          titleText
        )}
        {/* Secondary line (author, latest chapter, …) — bridge-supplied, absent for many. */}
        {entry.sub ? (
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            style={[
              styles.sub,
              { fontSize: compact ? SUB_FONT_SIZE.compact : SUB_FONT_SIZE.regular, lineHeight: compact ? SUB_LINE_HEIGHT.compact : SUB_LINE_HEIGHT.regular },
            ]}>
            {entry.sub}
          </ThemedText>
        ) : null}
        {/* Bottom filler — reserves the height a shorter-than-2:3 cover leaves unused (see fillFactor). */}
        {fillFactor > 0.001 && <View style={[styles.coverFill, { aspectRatio: 1 / fillFactor }]} />}
      </>
    );

    // Cover contents: the (optionally scaled) picture, overlaid badges/rank, and the native held
    // scrim. Shared by both the web (box > clip) and native (single merged box) structures below.
    const coverContents = (
      <>
        {/* Picture layer scaled by `pictureStyle` to fake the shrink illusion; badges/rank/ring are
            siblings so they never get stretched. Lightweight path (no scaling) skips the wrapper and
            renders the image/skeleton straight into the clip. */}
        {shrink.pictureStyle ? (
          <Animated.View style={[StyleSheet.absoluteFill, styles.picture, shrink.pictureStyle]}>
            {pictureInner}
          </Animated.View>
        ) : (
          pictureInner
        )}
        {entry.badges?.map((b, i) => <CardBadge key={i} badge={b} />)}
        {entry.unread != null && <UnreadBadge count={entry.unread} />}
        {rank != null && (
          <View style={styles.rank}>
            <ThemedText style={styles.rankText}>{rank}</ThemedText>
          </View>
        )}
        {/* Native held cue: a subtle scrim over the cover while pressed (web uses the ring instead). */}
        {active && !isWeb && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.heldScrim]} />}
      </>
    );

    return (
      <>
        {isWeb ? (
          // Web keeps a non-clipping `coverBox` around the clipping `coverClip` so the active hover
          // ring (negative insets) can extend past the clip without being cut off.
          <View style={[styles.coverBox, { aspectRatio: coverAspect }, coverHidden && styles.coverHidden]} onLayout={shrink.onCoverLayout}>
            <View style={styles.coverClip}>{coverContents}</View>
            {active && <View style={[styles.ring, { pointerEvents: 'none' }]} />}
          </View>
        ) : (
          // Native has no ring, so the box IS the clip — one fewer host view means one fewer Fabric
          // clone up the ancestor chain on every commit, on the platform that scrolls these grids.
          // `coverHidden` blanks just the cover while THIS card's long-press menu is open (its lifted
          // preview is a copy) — the title below stays visible under the dim.
          <View
            // The zoom entrance's source rect is measured off THIS box — see captureZoomOrigin.
            ref={coverRef}
            style={[styles.coverBoxClip, { aspectRatio: coverAspect }, coverHidden && styles.coverHidden]}
            onLayout={shrink.onCoverLayout}>
            {coverContents}
          </View>
        )}

        {/* Trailing group is an Animated.View only when the shrink illusion drives its translateY;
            otherwise a plain View, so lightweight cards carry no Reanimated wrapper here either. */}
        {shrink.trailingStyle ? (
          <Animated.View style={[styles.trailingGroup, shrink.trailingStyle]}>{trailingInner}</Animated.View>
        ) : (
          <View style={styles.trailingGroup}>{trailingInner}</View>
        )}
      </>
    );
  };

  return (
    <SeriesCardMenu
      enabled={menuEnabled}
      bridgeId={bridgeId}
      bridge={bridge}
      entry={entry}
      direct={direct}
      coverAspect={coverAspect}
      zoomSource={zoomSource}>
      {({ onLongPress, hidden }) => {
        // Built LAZILY (only when actually navigating) — NOT per render. This object plus its
        // encodeURIComponent/.replace string churn was allocated for every card on every render, so a
        // scroll that recycles many cards produced steady garbage → GC pauses (a top cost in the
        // release profile). Native builds it in onPress (once, on tap); web still needs it at render
        // for the <Link> anchor, so it's built there.
        //
        // `push` forces a new stack entry every time: expo-router's default `navigate` unwinds to an
        // existing `/series` route already on the stack instead of pushing another — so tapping a
        // related/recommended series from within a series-detail screen replaced the current screen
        // instead of drilling in. Also correct from Browse/Library/History (no `/series` on the stack
        // yet there, so equivalent to a plain push).
        const buildParams = () => ({
          id: entry.id,
          title: entry.title,
          // Percent-encoded (parens included — see encodeSeriesParam), and decoded back on the
          // series page with a single `decodeURIComponent`.
          ...(bridge ? { bridge: encodeSeriesParam(bridge) } : {}),
          // Forward the cover the browse grid already has so the series page can paint its hero
          // instantly from expo-image's cache, rather than shimmering until the detail resolves.
          ...(entry.cover ? { cover: encodeSeriesParam(entry.cover) } : {}),
          ...(bridgeId ? { bridgeId } : {}),
          ...(direct ? { direct: '1' } : {}),
        });
        const buildHref = () => ({
          pathname: '/series' as const,
          params: buildParams(),
        });
        // The drill (inside the series page's nested stack) dispatches on the NESTED navigator — no href.
        const open = () => (drillRelated ? drillRelated(buildParams()) : router.push(buildHref()));
        const pressable = (
          <Pressable
            testID={testId('series-card', entry.id)}
            // Flat single style object: as the `asChild` of <Link> (web), the Pressable is cloned by
            // expo-router's <Slot>, which rejects array styles.
            style={StyleSheet.flatten([
              styles.card,
              fixedWidth != null && { width: fixedWidth },
              // Lift the active card so its full-title popover draws over neighbours.
              active && styles.cardActive,
            ])}
            // Native: sliding off the card keeps it held; release clears it.
            pressRetentionOffset={HOLD_RETENTION}
            // On web the wrapping <Link> owns navigation via a real <a> (keeps middle-click /
            // open-in-new-tab / a crawlable href); on native we navigate imperatively so each card
            // doesn't mount an expo-router <Link> — its per-render router hooks were a top scroll cost
            // (createTask/ExpoLink), and native has no anchor semantics to preserve anyway.
            // A DRILL (inside the series page's nested stack) is imperative on web too — it targets the
            // nested navigator, which an anchor href can't express (see useDrillRelatedSeries).
            onPress={isWeb && !drillRelated ? undefined : open}
            // Native long-press opens the shared quick-actions menu; undefined on web (which uses the
            // hover 3-dot instead). A long-press suppresses the tap, so it never also navigates.
            onLongPress={onLongPress}
            {...handlers}
            // After the spread so it wins, and calls through to the held-state's own press-in.
            onPressIn={() => {
              handlers.onPressIn();
              captureZoomOrigin();
            }}>
            {/* Shrink illusion only when Lightweight is off: wrap in CoverShrink (owns the reanimated
                hooks + supplies real animated styles); otherwise render plainly with a no-op API. */}
            {lightCards ? (
              renderCardBody(NOOP_SHRINK, hidden || zoomFlying)
            ) : (
              <CoverShrink entryId={entry.id}>
                {(shrink) => renderCardBody(shrink, hidden || zoomFlying)}
              </CoverShrink>
            )}
          </Pressable>
        );
        // Web keeps the real anchor (asChild clones it onto the Pressable); native — and a drill,
        // whose nested-navigator target no anchor href can express — renders the Pressable
        // directly and navigates imperatively on press.
        return isWeb && !drillRelated ? (
          // eslint-disable-next-line comical/require-test-id -- asChild: clones onto the Pressable, which carries the testID.
          <Link push href={buildHref()} asChild>
            {pressable}
          </Link>
        ) : (
          pressable
        );
      }}
    </SeriesCardMenu>
  );
}

/**
 * The full-title popover. Used in-card by the grid and lifted out of the
 * scroller by the rail (which passes a positioning `style`). Its content box
 * matches the clamped title width so the first lines wrap identically.
 */
export function TitlePeek({
  title,
  style,
}: {
  title: string;
  // Accepts plain styles (grid, in-card) or a reanimated style (rail, the
  // UI-thread scroll transform).
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
}) {
  const theme = useTheme();
  // Match the card title's responsive size so the popover wraps identically.
  const compact = useIsCompact();
  const titleSize = {
    fontSize: compact ? TITLE_FONT_SIZE.compact : TITLE_FONT_SIZE.regular,
    lineHeight: compact ? TITLE_LINE_HEIGHT.compact : TITLE_LINE_HEIGHT.regular,
  };
  // Animated.View so the rail can hand it a UI-thread transform that tracks the
  // strip's scroll (the grid passes a plain style and it renders unchanged).
  return (
    <Animated.View
      style={[styles.titlePopover, { backgroundColor: theme.backgroundElement }, style, { pointerEvents: 'none' }]}>
      <ThemedText type="small" style={[styles.title, titleSize]}>
        {title}
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    // A touch more breathing room between the thumbnail and its title.
    gap: Spacing.two,
  },
  cardActive: {
    zIndex: 10,
  },
  coverBox: {
    // The cover itself, top-aligned at its real (capped) aspect ratio — shorter
    // than the 2:3 max for a wider-than-2:3 cover; `coverFill` reserves the rest.
    width: '100%',
    position: 'relative',
  },
  coverBoxClip: {
    // Native-only: `coverBox` and `coverClip` merged into one host view (no hover ring to escape the
    // clip there). Same aspect box, but it clips + backs the cover directly — one fewer view per card.
    width: '100%',
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  coverFill: {
    // Bottom filler that reserves a shorter cover's unused height so every card is
    // the same total height. The negative margin cancels the card's `gap` before
    // it, so it contributes exactly its own (aspect-derived) height and nothing
    // more. `aspectRatio` is set per-card from `fillFactor`. Non-interactive.
    width: '100%',
    marginTop: -Spacing.two,
    pointerEvents: 'none',
  },
  coverClip: {
    // Fixed (never transformed) clipping ancestor — the scaled `picture` layer
    // sits inside this, since clipping the SAME element being scaled wouldn't
    // actually contain overflow (the clip rect would scale with the transform).
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  picture: {
    // Top-aligned scale origin so the shrink illusion (`pictureStyle`) settles
    // toward the bottom, matching `coverBox`'s own top-aligned layout.
    transformOrigin: 'top',
  },
  hiddenCover: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Blanks just the cover while this card's long-press menu is open, or while its zoom transition
  // is flying — both show a COPY of it, so leaving the original visible would double it. Layout is
  // preserved; only the cover goes invisible.
  coverHidden: {
    opacity: 0,
  },
  trailingGroup: {
    // Replaces the spacing `card`'s own `gap` used to provide between the cover
    // and title/sub/fill when they were direct siblings — now that they're
    // wrapped together (so the whole group can be nudged by `trailingStyle`),
    // this reproduces that spacing internally.
    gap: Spacing.two,
  },
  heldScrim: {
    // Non-scaling press feedback on native — a light dark wash over the cover. Sits inside
    // `coverClip` so it inherits the cover's rounded corners.
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  ring: {
    position: 'absolute',
    // Offset == border width, so the ring's inner edge is flush with the cover
    // (no gap) while the stroke itself sits just outside it.
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#60a5fa',
  },
  titleWrap: {
    position: 'relative',
  },
  title: {
    fontWeight: '600',
  },
  sub: {
    // `card`'s outer `gap` (Spacing.two, 8px) already separates title from sub;
    // pull it in to the reference's tighter title→sub gap (`.card-sub`'s
    // margin-top: 0.2rem ≈ 3px), vs. the ~6px reference gives cover→title.
    marginTop: -5,
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
    zIndex: -1,
  },
  titlePopover: {
    position: 'absolute',
    // Expand slightly past the card: insets equal the horizontal padding, so the
    // text column lines up with the clamped title and wraps identically (no word
    // reflow), while the box reads as a popover lifting off the card.
    top: -Spacing.one,
    left: -Spacing.two,
    right: -Spacing.two,
    zIndex: 1000,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 8,
    // Soft lift so it reads as floating over the cards below it.
    boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.25)',
    elevation: 6,
  },
  rank: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 2,
    backgroundColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  rankText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
});
