import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { type SharedValue } from 'react-native-reanimated';

import {
  edgeOffset,
  farEdge,
  fillRule,
  isStrip,
  pageGeometry,
  panLimits,
  stripGeometry,
  type RestEdge,
  type Size,
} from '@/components/reader/page-geometry';
import { ReaderPage } from '@/components/reader/reader-page';
import { useZoomable } from '@/components/reader/use-zoomable';
import type { DoubleTapMode, PageFit } from '@/hooks/use-reader-settings';

// A single paged-reader page (NATIVE only — web has its own gesture pager in
// paged-reader.web.tsx and never renders this).
//
// Pinch / double-tap / pan all come from the shared `useZoomable` primitive (also used by the
// webtoon reader). This file adds only the things that are page-specific: the tap-zone
// navigation (left/right turn, centre toggles chrome) and the page's box and rest (see
// page-geometry) — a strip under fit-width is a box taller than the viewport, panned down by the
// same gesture that pans a zoomed page, with the same momentum and the same hand-off to the
// pager for a sideways drag.
//
// Navigation is handled by a single-tap gesture composed Exclusive with the
// double-tap so it waits out a possible second tap.

type Props = {
  uri: string;
  page: number;
  width: number;
  height: number;
  pageFit: PageFit;
  /** Reading direction — which edge of a spread it rests at. */
  rtl: boolean;
  /** What a double-tap does (`useReaderSettings().doubleTap`). */
  doubleTap: DoubleTapMode;
  /** The switch-fit a double-tap asks for under that mode, given the page's picture (or null
   *  before it has loaded) — which axis it goes to depends on the page's shape. */
  onSwitchFit: (image: Size | null) => void;
  /** Cross-fade override for this page — see ReaderPage's `fadeMs`. */
  fadeMs?: number;
  /** Whether this is the page currently in view; losing focus resets the zoom. */
  active: boolean;
  /** True while the reader is parked as a decorative strip or still playing its entrance (the
   *  pager's own `standby`). The page holds at 1× for the duration — the entrance poster over it
   *  is the contain picture, so a page that rested zoomed under it would be revealed mid-jump —
   *  and grows into its rest once the reader is primary. */
  standby?: boolean;
  /** True for a page BEFORE the one being read: it rests at its far edge, so a backward swipe
   *  lands where reading left off. Latched while the page is on screen — the pager's answer flips
   *  the moment the page becomes the one being read, and the edge it arrived on must not. */
  restAtFarEdge?: boolean;
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
  doubleTap,
  onSwitchFit,
  fadeMs,
  active,
  standby = false,
  restAtFarEdge = false,
  onLeft,
  onRight,
  onToggleChrome,
  onZoomChange,
  onPinchChange,
  scrubbing,
  scrollGesture,
}: Props) {
  const [pageFailed, setPageFailed] = useState(false);
  // The picture's real dimensions, once loaded — what the page's box and rest are read from.
  const [image, setImage] = useState<Size | null>(null);

  // Which pages rest above 1× under the fit (see `fillRule`). Every page is drawn in the contain
  // box, under either axis — a box the viewport's size that never changes, which is what keeps a
  // page from shifting as its picture arrives — except a STRIP under fit-width, a page taller than
  // the viewport at its width, which gets a box that tall (see `stripGeometry`) and is panned
  // down it. Before the picture's shape is known every page is contain.
  const fill = standby ? 'none' : fillRule(pageFit);
  const strip = pageFit === 'fit-width' && isStrip(image, { width, height });

  // The edge this page rests at, latched while active (see `restAtFarEdge`). React's own form of
  // the previous-prop pattern, so a discarded render re-runs the comparison.
  const [farEdgeLatched, setFarEdgeLatched] = useState(restAtFarEdge);
  if (!active && farEdgeLatched !== restAtFarEdge) setFarEdgeLatched(restAtFarEdge);
  const edgeFor = useCallback(
    (edge: RestEdge) => (farEdgeLatched ? farEdge(edge) : edge),
    [farEdgeLatched],
  );

  const geometry = useMemo(
    () => (strip && image ? stripGeometry(image, { width, height }) : pageGeometry(image, { width, height }, fill, rtl)),
    [strip, fill, image, width, height, rtl],
  );

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

  const switchFit = useCallback(() => onSwitchFit(image), [onSwitchFit, image]);

  // The whole zoom gesture (pinch / double-tap / one-finger pan / the tap zones,
  // all composed) comes from the shared hook; this page just feeds it the box, the rest and the
  // tap-zone handler. Zoom is off while the page shows its failed/Retry state so a tap reaches
  // the chip.
  //
  // Swiping to another page (or jumping via the progress pill) puts this one back to rest, so
  // every page starts from rest — fit-to-screen, or fit-height for a spread. That is only ever
  // right while `active` is CURRENT, which on a virtualized list is not free: see the pager's
  // `extraData`, without which a cell kept the value it first rendered with and the reset fired on
  // the page being zoomed.
  const { gesture, animatedStyle, settle } = useZoomable({
    width,
    height,
    enabled: !pageFailed,
    active,
    content: geometry.content,
    restScale: geometry.restScale,
    restEdge: edgeFor(geometry.restEdge),
    onZoomChange,
    onPinchChange,
    onSingleTap: onTapNav,
    singleTapEnabled: !pageFailed,
    doubleTapEnabled: doubleTap !== 'off',
    onDoubleTap: doubleTap === 'switch-fit' ? switchFit : undefined,
    simultaneousExternal: scrollGesture,
  });

  const onLoadDims = (w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const img = { width: w, height: h };
    // The rest this picture's shape gives the page, applied BEFORE the render that carries it
    // (see useZoomable's `settle`), so the page is drawn at rest from its first frame rather
    // than growing into it — a strip from its top.
    const g =
      pageFit === 'fit-width' && isStrip(img, { width, height })
        ? stripGeometry(img, { width, height })
        : pageGeometry(img, { width, height }, fill, rtl);
    const off = edgeOffset(edgeFor(g.restEdge), panLimits(g.restScale, g.content, { width, height }));
    settle(g.restScale, off.x, off.y);
    setImage(img);
  };

  // A page that goes away mid-pinch (a mode switch, a window that dropped it) never reaches the
  // gesture's own `onFinalize`, and the pager would be left frozen on a pinch nothing can end.
  useEffect(() => () => onPinchChange?.(false), [onPinchChange]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width, height }]}>
        {/* The transformed view is the viewport's size and centres its box: the viewport-sized
            contain box for most pages, a taller one for a strip, which overflows it equally top
            and bottom and is clipped by `styles.page`. */}
        <Animated.View style={[{ width, height }, styles.centred, animatedStyle]}>
          <ReaderPage
            fadeMs={fadeMs}
            uri={uri}
            page={page}
            fit="contain"
            width={width}
            height={strip ? geometry.content.height : height}
            onLoadDims={onLoadDims}
            onFailedChange={setPageFailed}
            scrubbing={scrubbing}
          />
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
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
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
