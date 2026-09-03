import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { edgeOffset, fillRule, pageGeometry, panLimits, type EffectiveFit, type Size } from '@/components/reader/page-geometry';
import { ReaderPage } from '@/components/reader/reader-page';
import { useZoomable } from '@/components/reader/use-zoomable';
import type { DoubleTapMode, PageFit } from '@/hooks/use-reader-settings';

// A single paged-reader page (NATIVE only — web has its own gesture pager in
// paged-reader.web.tsx and never renders this).
//
// Pinch / double-tap / pan-while-zoomed all come from the shared `useZoomable`
// primitive (also used by the webtoon reader). This file adds only the things
// that are page-specific: the tap-zone navigation (left/right turn, centre
// toggles chrome) and the fit-width vertical content-pan.
//
// Navigation is handled by a single-tap gesture composed Exclusive with the
// double-tap so it waits out a possible second tap. `pageFit === 'fit-width'`
// fills the width edge to edge; if that makes the page taller than the viewport,
// a one-finger vertical drag scrolls that content instead (mutually exclusive
// with pinch-zoom — see `contentPan`); a page SHORTER than the viewport sits
// centred in it. `pageFit === 'fit-height'` draws the contain layout and rests
// the page at the viewport's height wherever that is the bigger fit, panned
// sideways (see page-geometry) — which, with `zoomWidePages`, fit-width also
// does to a SPREAD.

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

type Props = {
  uri: string;
  page: number;
  width: number;
  height: number;
  pageFit: PageFit;
  /** Reading direction — which edge of a spread it rests at. */
  rtl: boolean;
  /** The spread rule (`useReaderSettings().zoomWidePages`). */
  zoomWidePages: boolean;
  /** What a double-tap does (`useReaderSettings().doubleTap`). */
  doubleTap: DoubleTapMode;
  /** The fill-height toggle a double-tap asks for under that mode. */
  onToggleFillHeight: () => void;
  /** Cross-fade override for this page — see ReaderPage's `fadeMs`. */
  fadeMs?: number;
  /** Whether this is the page currently in view; losing focus resets the zoom. */
  active: boolean;
  /** True while the reader is parked as a decorative strip or still playing its entrance (the
   *  pager's own `standby`). The page holds at 1× for the duration — the entrance poster over it
   *  is the contain picture, so a page that rested zoomed under it would be revealed mid-jump —
   *  and grows into its rest once the reader is primary. */
  standby?: boolean;
  onLeft: () => void;
  onRight: () => void;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
  /** Reported at the START of a pinch, not at its settle — the pager freezes its scroll for the
   *  duration. See `useZoomable`'s `onPinchChange`. */
  onPinchChange?: (pinching: boolean) => void;
  /** The pager's scrub position, passed straight through to ReaderPage — see its `scrubbing`. */
  scrubbing?: SharedValue<number>;
  /** Every gesture the PAGER has mounted on its scroller — its `Gesture.Native()` and its edge pan.
   *  A page lives inside that scroller, so each of these arbitrates against the gestures in here,
   *  and a descendant that hasn't declared it can run alongside them loses. All of them, not just
   *  the scroll: the edge pan is a pan on the same surface and takes the double-tap with it.
   *  Omitted where the scroller isn't in RNGH's graph at all, which is how this file used to get
   *  away with declaring nothing. */
  scrollGesture?: GestureType[];
};

// Non-interactive markers only: navigation taps are handled by the GestureDetector
// below (`singleTap`) so they compose cleanly with double-tap-to-zoom. These Views
// keep the `reader.control.*` testIDs at the right coordinates so Maestro's
// `tapOn: id` still lands in the correct zone, but `pointerEvents: none` means they
// never claim a touch away from the gestures.
function TapZones() {
  return (
    <View style={[StyleSheet.absoluteFill, styles.zones]} pointerEvents="none">
      <View testID="reader.control.prev" style={styles.side} />
      <View testID="reader.control.toggle-chrome" style={styles.center} />
      <View testID="reader.control.next" style={styles.side} />
    </View>
  );
}

export function ZoomablePage({
  uri,
  page,
  width,
  height,
  pageFit,
  rtl,
  zoomWidePages,
  doubleTap,
  onToggleFillHeight,
  fadeMs,
  active,
  standby = false,
  onLeft,
  onRight,
  onToggleChrome,
  onZoomChange,
  onPinchChange,
  scrubbing,
  scrollGesture,
}: Props) {
  const [pageFailed, setPageFailed] = useState(false);

  // fit-width content that's taller than the viewport: a one-finger vertical
  // drag scrolls it (see `contentPan` below). `contentHeight` is only known
  // once the real image dims load — see `onLoadDims`.
  const contentHeight = useSharedValue(height);
  const contentTy = useSharedValue(0);
  const savedContentTy = useSharedValue(0);
  const [overflowsVertically, setOverflowsVertically] = useState(false);
  const [contentPanning, setContentPanning] = useState(false);
  // The picture's real dimensions, once loaded — what the page's rest and pan bounds are read from.
  const [image, setImage] = useState<Size | null>(null);

  // Which pages rest above 1× under the fit (see `fillRule`), and the layout: the contain box
  // for everything that FITS — under either axis, a page that fits is drawn the same way, in a
  // box that never changes size, which is what keeps it from shifting as its picture arrives —
  // and the top-aligned, vertically scrolled `width` layout only for a page that overflows the
  // height under fit-width, a strip. Before the picture's shape is known every page is contain.
  const fill = standby ? 'none' : fillRule(pageFit, zoomWidePages);
  const layoutFor = useCallback(
    (overflows: boolean): EffectiveFit => (pageFit === 'fit-width' && overflows ? 'fit-width' : 'fit-page'),
    [pageFit],
  );
  const fit = layoutFor(overflowsVertically);

  // Only a fit-page picture is centred in the viewport, which is what the hook's content clamp
  // assumes; a fit-width one is top-aligned and keeps the viewport clamp it always had.
  const geometry = useMemo(
    () => pageGeometry(fit === 'fit-page' ? image : null, { width, height }, fill, rtl),
    [fit, fill, image, width, height, rtl],
  );

  // Compounding pinch's scale/anchor math with an independent content-pan offset
  // is a correctness trap, so the two are made mutually exclusive: zoom is
  // disabled exactly when `contentPan` would be enabled. Zoom is also off while
  // the page shows its failed/Retry state so a tap reaches the Retry chip.
  const zoomEnabled = !(fit === 'fit-width' && overflowsVertically) && !pageFailed;
  // The page-turn / chrome tap zones stay live except while zoomed or suspended.
  const suspended = pageFailed || contentPanning;

  // Navigation for a single tap, by the tap's x within the page — the same three
  // zones the `TapZones` markers cover (~30% / ~40% / ~30%).
  const onTapNav = useCallback(
    (x: number) => {
      if (x < width * 0.3) onLeft();
      else if (x > width * 0.7) onRight();
      else onToggleChrome();
    },
    [width, onLeft, onRight, onToggleChrome],
  );

  // One-finger vertical scroll of an overflowing fit-width page. A deadzone
  // (`activeOffsetY`) plus `failOffsetX` disambiguate it from the FlatList's own
  // horizontal swipe: a mostly-vertical drag wins here, a mostly-horizontal one
  // bails out and lets the page-turn swipe handle it. (No `!zoomed` guard needed —
  // an overflowing fit-width page can't zoom in the first place, so `zoomEnabled`
  // is already false and this never coexists with a zoom.)
  const contentPan = Gesture.Pan()
    .enabled(fit === 'fit-width' && overflowsVertically)
    .activeOffsetY([-10, 10])
    .failOffsetX([-15, 15])
    // Alongside whatever the pager mounted on its scroller (see `scrollGesture`). The axes already
    // separate these — this is only about being allowed to run at all.
    .simultaneousWithExternalGesture(...(scrollGesture ?? []))
    .onStart(() => {
      savedContentTy.set(contentTy.value);
      runOnJS(setContentPanning)(true);
    })
    .onUpdate((e) => {
      const maxOffset = Math.max(0, contentHeight.value - height);
      contentTy.set(clamp(savedContentTy.value + e.translationY, -maxOffset, 0));
    })
    .onEnd(() => {
      savedContentTy.set(contentTy.value);
      runOnJS(setContentPanning)(false);
    });

  // The whole zoom gesture (pinch / double-tap / one-finger pan / the tap zones,
  // all composed) comes from the shared hook; this page just feeds it the tap-zone
  // handler and its content-pan.
  //
  // Swiping to another page (or jumping via the progress pill) puts this one back to rest, so
  // every page starts from rest — fit-to-screen, or fit-height for a spread. That is only ever
  // right while `active` is CURRENT, which on a virtualized list is not free: see the pager's
  // `extraData`, without which a cell kept the value it first rendered with and the reset fired on
  // the page being zoomed.
  const { gesture, animatedStyle, settle } = useZoomable({
    width,
    height,
    enabled: zoomEnabled,
    active,
    content: fit === 'fit-page' ? geometry.content : undefined,
    restScale: geometry.restScale,
    restEdge: geometry.restEdge,
    onZoomChange,
    onPinchChange,
    onSingleTap: onTapNav,
    singleTapEnabled: !suspended,
    doubleTapEnabled: doubleTap !== 'off',
    onDoubleTap: doubleTap === 'switch-fit' ? onToggleFillHeight : undefined,
    extraSimultaneous: [contentPan],
    simultaneousExternal: scrollGesture,
  });

  const onLoadDims = (w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const ch = width * (h / w);
    const overflows = ch > height + 1;
    // The rest this picture's shape gives the page, applied BEFORE the render that carries it
    // (see useZoomable's `settle`), so the page is drawn at rest from its first frame rather
    // than growing into it.
    const g = pageGeometry(layoutFor(overflows) === 'fit-page' ? { width: w, height: h } : null, { width, height }, fill, rtl);
    settle(g.restScale, edgeOffset(g.restEdge, panLimits(g.restScale, g.content, { width, height }).x));
    contentHeight.set(ch);
    setOverflowsVertically(overflows);
    setImage({ width: w, height: h });
  };

  // A page that goes away mid-pinch (a mode switch, a window that dropped it) never reaches the
  // gesture's own `onFinalize`, and the pager would be left frozen on a pinch nothing can end.
  useEffect(() => () => onPinchChange?.(false), [onPinchChange]);

  // Same for content-pan: a page left behind always comes back scrolled to the top.
  useEffect(() => {
    if (!active) {
      contentTy.set(0);
      savedContentTy.set(0);
    }
  }, [active, contentTy, savedContentTy]);

  const contentPanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: contentTy.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width, height }]}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <Animated.View style={[{ width }, contentPanStyle]}>
            <ReaderPage
              fadeMs={fadeMs}
              uri={uri}
              page={page}
              fit={fit === 'fit-width' ? 'width' : 'contain'}
              width={width}
              height={height}
              onLoadDims={onLoadDims}
              onFailedChange={setPageFailed}
              scrubbing={scrubbing}
            />
          </Animated.View>
        </Animated.View>
        <TapZones />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  page: {
    overflow: 'hidden',
  },
  zones: {
    flexDirection: 'row',
  },
  side: {
    flex: 3, // ~30%
  },
  center: {
    flex: 4, // ~40%
  },
});
