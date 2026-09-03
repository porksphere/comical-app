import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { pageLayout, type Size } from '@/components/reader/page-geometry';
import { ReaderPage } from '@/components/reader/reader-page';
import { useZoomable } from '@/components/reader/use-zoomable';
import type { DoubleTapMode, PageFit } from '@/hooks/use-reader-settings';

// A single paged-reader page (NATIVE only — web has its own gesture pager in
// paged-reader.web.tsx and never renders this).
//
// The page is DRAWN in the box its fit gives it (see page-geometry's `pageLayout`), centred in
// the viewport: the whole page for one that fits, a box wider than the screen for a fit-height
// page on a phone, a box taller than it for a strip under fit-width. Where the box overflows it
// is panned, at 1×, from its reading edge. Pinch / double-tap / pan all come from the shared
// `useZoomable` primitive (also used by the webtoon reader), which clamps to that box; this file
// adds only the things that are page-specific — the tap-zone navigation (left/right turn, centre
// toggles chrome) and the layout itself.
//
// Navigation is handled by a single-tap gesture composed Exclusive with the
// double-tap so it waits out a possible second tap.

type Props = {
  uri: string;
  page: number;
  width: number;
  height: number;
  pageFit: PageFit;
  /** Reading direction — which edge a sideways-overflowing page starts at. */
  rtl: boolean;
  /** The spread rule under fit-width (`useReaderSettings().zoomWidePages`). */
  zoomWidePages: boolean;
  /** What a double-tap does (`useReaderSettings().doubleTap`). */
  doubleTap: DoubleTapMode;
  /** The switch-fit toggle a double-tap asks for under that mode. */
  onToggleFillHeight: () => void;
  /** Cross-fade override for this page — see ReaderPage's `fadeMs`. */
  fadeMs?: number;
  /** Whether this is the page currently in view; losing focus resets the zoom. */
  active: boolean;
  /** True while the reader is parked as a decorative strip or still playing its entrance (the
   *  pager's own `standby`). The page is drawn contain-fit for the duration — the entrance
   *  poster over it is the contain picture, so a page laid out wider than the screen under it
   *  would be revealed mid-jump — and takes its real layout once the reader is primary. */
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
  // The picture's real dimensions, once loaded — what the page's box is laid out from.
  const [image, setImage] = useState<Size | null>(null);

  const onLoadDims = useCallback((w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    setImage({ width: w, height: h });
  }, []);

  const layout = useMemo(
    () => pageLayout(image, { width, height }, standby ? 'contain' : pageFit, zoomWidePages, rtl),
    [image, width, height, standby, pageFit, zoomWidePages, rtl],
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

  // The whole zoom gesture (pinch / double-tap / one-finger pan / the tap zones,
  // all composed) comes from the shared hook; this page just feeds it the box and the tap-zone
  // handler. Zoom is off while the page shows its failed/Retry state so a tap reaches the chip.
  //
  // Swiping to another page (or jumping via the progress pill) puts this one back to rest, so
  // every page starts from rest. That is only ever right while `active` is CURRENT, which on a
  // virtualized list is not free: see the pager's `extraData`, without which a cell kept the
  // value it first rendered with and the reset fired on the page being zoomed.
  const { gesture, animatedStyle } = useZoomable({
    width,
    height,
    enabled: !pageFailed,
    active,
    content: layout.box,
    edge: layout.edge,
    // A box that comes from a real picture changes for a reason the reader can see (a fit
    // switched, the entrance settling), and zooms between its two layouts; the change from the
    // placeholder's box to the picture's is applied instantly.
    animateLayout: image != null,
    onZoomChange,
    onPinchChange,
    onSingleTap: onTapNav,
    singleTapEnabled: !pageFailed,
    doubleTapEnabled: doubleTap !== 'off',
    onDoubleTap: doubleTap === 'switch-fit' ? onToggleFillHeight : undefined,
    simultaneousExternal: scrollGesture,
  });

  // A page that goes away mid-pinch (a mode switch, a window that dropped it) never reaches the
  // gesture's own `onFinalize`, and the pager would be left frozen on a pinch nothing can end.
  useEffect(() => () => onPinchChange?.(false), [onPinchChange]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width, height }]}>
        <Animated.View style={[{ width: layout.box.width, height: layout.box.height }, animatedStyle]}>
          <ReaderPage
            fadeMs={fadeMs}
            uri={uri}
            page={page}
            fit="contain"
            width={layout.box.width}
            height={layout.box.height}
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
  // The box sits centred in the viewport, which is what the hook's pan and pinch math assumes,
  // and is clipped by it — an overflowing box is seen through this window.
  page: {
    overflow: 'hidden',
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
