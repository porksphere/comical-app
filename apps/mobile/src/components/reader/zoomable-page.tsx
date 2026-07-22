import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';

import { ReaderPage } from '@/components/reader/reader-page';
import type { PageFit } from '@/hooks/use-reader-settings';

// A single paged-reader page (NATIVE only — web has its own gesture pager in
// paged-reader.web.tsx and never renders this).
//
// Navigation is plain Pressable tap zones (left/right turn, centre toggles
// chrome) so taps fire immediately and a one-finger drag falls through to the
// FlatList for swiping. A GestureDetector adds pinch-to-zoom and pan-while-
// zoomed; react-native-gesture-handler coexists with the FlatList on native.
//
// `pageFit === 'fit-width'` fills the width edge to edge; if that makes the
// page taller than the viewport, a one-finger vertical drag scrolls that
// content instead (mutually exclusive with pinch-zoom — see `contentPan`
// below). `pageFit === 'fit-page'` is today's behavior: the whole page
// visible, letterboxed, still pinch-zoomable.

const MAX_SCALE = 4;
// Below this we treat the page as "not zoomed" (and snap back to a clean 1×).
const ZOOM_EPSILON = 1.01;
// Scale a double-tap zooms into (and back out of).
const DOUBLE_TAP_SCALE = 2.5;
// A pinch that reached at least this scale counts as a deliberate zoom-in, so a
// final frame that dips under ZOOM_EPSILON on lift (common on a fast pinch)
// commits the zoom instead of rubber-banding to 1×.
const PINCH_COMMIT = 1.2;

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
  /** Whether this is the page currently in view; losing focus resets the zoom. */
  active: boolean;
  onLeft: () => void;
  onRight: () => void;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
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
  active,
  onLeft,
  onRight,
  onToggleChrome,
  onZoomChange,
}: Props) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  // Anchor captured once when a pinch begins, so the transform is derived from
  // fixed values each frame instead of compounding per-frame deltas.
  const focalStartX = useSharedValue(0);
  const focalStartY = useSharedValue(0);
  const baseScale = useSharedValue(1);
  const baseTx = useSharedValue(0);
  const baseTy = useSharedValue(0);
  // Largest scale reached during the current pinch — lets the release tell a real
  // zoom-in (whose last frame may dip on lift) from a tiny/settled pinch.
  const pinchMaxScale = useSharedValue(1);

  const [zoomed, setZoomed] = useState(false);
  const [pageFailed, setPageFailed] = useState(false);

  // fit-width content that's taller than the viewport: a one-finger vertical
  // drag scrolls it (see `contentPan` below). `contentHeight` is only known
  // once the real image dims load — see `onLoadDims`.
  const contentHeight = useSharedValue(height);
  const contentTy = useSharedValue(0);
  const savedContentTy = useSharedValue(0);
  const [overflowsVertically, setOverflowsVertically] = useState(false);
  const [contentPanning, setContentPanning] = useState(false);

  const onLoadDims = useCallback(
    (w: number, h: number) => {
      if (w <= 0) return;
      const ch = width * (h / w);
      contentHeight.set(ch);
      setOverflowsVertically(ch > height + 1);
    },
    [width, height, contentHeight],
  );

  const reportZoom = useCallback(
    (next: boolean) => {
      setZoomed(next);
      onZoomChange(next);
    },
    [onZoomChange],
  );

  // Navigation for a single tap, dispatched by the `singleTap` gesture using the
  // tap's x within the page — the same three zones the `TapZones` markers cover
  // (~30% / ~40% / ~30%).
  const onTapNav = useCallback(
    (x: number) => {
      if (x < width * 0.3) onLeft();
      else if (x > width * 0.7) onRight();
      else onToggleChrome();
    },
    [width, onLeft, onRight, onToggleChrome],
  );

  const reset = useCallback(() => {
    scale.set(1);
    tx.set(0);
    ty.set(0);
    savedTx.set(0);
    savedTy.set(0);
    reportZoom(false);
  }, [scale, tx, ty, savedTx, savedTy, reportZoom]);

  // Swiping to another page (or jumping via the progress pill) drops the zoom so
  // every page starts fit-to-screen.
  useEffect(() => {
    if (!active && zoomed) reset();
  }, [active, zoomed, reset]);

  // Same for content-pan: a page left behind always comes back scrolled to the top.
  useEffect(() => {
    if (!active) {
      contentTy.set(0);
      savedContentTy.set(0);
    }
  }, [active, contentTy, savedContentTy]);

  // Disabled while a fit-width page overflows vertically — compounding pinch's
  // scale/anchor math with an independent content-pan offset is a correctness
  // trap, not just extra code, so the two are made mutually exclusive instead:
  // `zoomed` can only become true from this gesture's own `onEnd`, and it's
  // disabled exactly when `contentPan` below would be enabled.
  const pinchEnabled = !(pageFit === 'fit-width' && overflowsVertically);

  const pinch = Gesture.Pinch()
    .enabled(pinchEnabled)
    .onStart((e) => {
      focalStartX.set(e.focalX);
      focalStartY.set(e.focalY);
      baseScale.set(scale.value);
      baseTx.set(tx.value);
      baseTy.set(ty.value);
      pinchMaxScale.set(scale.value);
    })
    .onUpdate((e) => {
      const cx = width / 2;
      const cy = height / 2;
      const nextScale = clamp(baseScale.value * e.scale, 1, MAX_SCALE);
      if (nextScale > pinchMaxScale.value) pinchMaxScale.set(nextScale);
      const anchorX = (focalStartX.value - cx - baseTx.value) / baseScale.value;
      const anchorY = (focalStartY.value - cy - baseTy.value) / baseScale.value;
      const limitX = ((nextScale - 1) * width) / 2;
      const limitY = ((nextScale - 1) * height) / 2;
      tx.set(clamp(e.focalX - cx - nextScale * anchorX, -limitX, limitX));
      ty.set(clamp(e.focalY - cy - nextScale * anchorY, -limitY, limitY));
      scale.set(nextScale);
    })
    .onEnd(() => {
      if (scale.value > ZOOM_EPSILON) {
        savedTx.set(tx.value);
        savedTy.set(ty.value);
        runOnJS(reportZoom)(true);
        return;
      }
      // Ended at ~1×. A fast pinch-in's LAST frame often dips under the epsilon as
      // the fingers converge on lift — don't rubber-band those: if the pinch STARTED
      // from ~1× and actually reached a real zoom, commit at that peak instead. A
      // pinch that started already-zoomed still honours a deliberate return to 1×.
      if (baseScale.value <= ZOOM_EPSILON && pinchMaxScale.value > PINCH_COMMIT) {
        const target = clamp(pinchMaxScale.value, 1, MAX_SCALE);
        const limitX = ((target - 1) * width) / 2;
        const limitY = ((target - 1) * height) / 2;
        scale.set(withTiming(target));
        tx.set(withTiming(clamp(tx.value, -limitX, limitX)));
        ty.set(withTiming(clamp(ty.value, -limitY, limitY)));
        savedTx.set(clamp(tx.value, -limitX, limitX));
        savedTy.set(clamp(ty.value, -limitY, limitY));
        runOnJS(reportZoom)(true);
        return;
      }
      scale.set(withTiming(1));
      tx.set(withTiming(0));
      ty.set(withTiming(0));
      savedTx.set(0);
      savedTy.set(0);
      runOnJS(reportZoom)(false);
    });

  // One-finger pan, only while zoomed (so it never steals a swipe at 1×). Capped at
  // a single pointer so a two-finger pinch never registers as a pan and flings on
  // release — momentum belongs to a deliberate one-finger drag, not to zooming.
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .maxPointers(1)
    .onStart(() => {
      savedTx.set(tx.value);
      savedTy.set(ty.value);
    })
    .onUpdate((e) => {
      const limitX = ((scale.value - 1) * width) / 2;
      const limitY = ((scale.value - 1) * height) / 2;
      tx.set(clamp(savedTx.value + e.translationX, -limitX, limitX));
      ty.set(clamp(savedTy.value + e.translationY, -limitY, limitY));
    })
    // Fling the zoomed image: keep gliding on release, decelerating and stopping
    // at the pan bounds (`clamp`). The next pan's onStart re-captures tx/ty as its
    // base, so grabbing mid-glide continues seamlessly from wherever it's coasted.
    .onEnd((e) => {
      const limitX = ((scale.value - 1) * width) / 2;
      const limitY = ((scale.value - 1) * height) / 2;
      tx.set(withDecay({ velocity: e.velocityX, clamp: [-limitX, limitX], deceleration: 0.994 }));
      ty.set(withDecay({ velocity: e.velocityY, clamp: [-limitY, limitY], deceleration: 0.994 }));
    });

  // One-finger vertical scroll of an overflowing fit-width page. A deadzone
  // (`activeOffsetY`) plus `failOffsetX` disambiguate it from the FlatList's
  // own horizontal swipe: a mostly-vertical drag wins here, a mostly-horizontal
  // one bails out and lets the page-turn swipe handle it as always. Because a
  // true tap never moves 10px, ordinary taps still reach `TapZones` untouched.
  const contentPan = Gesture.Pan()
    .enabled(pageFit === 'fit-width' && overflowsVertically && !zoomed)
    .activeOffsetY([-10, 10])
    .failOffsetX([-15, 15])
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

  // Double-tap toggles between fit-to-screen and a fixed zoom, centred on the tap
  // point (clamped into bounds). Disabled during the failed/Retry or content-pan
  // states (same `suspended` rule the old Pressable zones used).
  const suspended = pageFailed || contentPanning;
  const doubleTap = Gesture.Tap()
    .enabled(!suspended)
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((e) => {
      if (scale.value > ZOOM_EPSILON) {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
        savedTx.set(0);
        savedTy.set(0);
        runOnJS(reportZoom)(false);
        return;
      }
      const cx = width / 2;
      const cy = height / 2;
      const limitX = ((DOUBLE_TAP_SCALE - 1) * width) / 2;
      const limitY = ((DOUBLE_TAP_SCALE - 1) * height) / 2;
      // Keep the tapped content point under the finger: at 1× a screen point maps
      // to content offset (p − centre); after scaling, translate so it lands back
      // where it was tapped, i.e. tx = (p − centre)(1 − scale).
      const nextTx = clamp((e.x - cx) * (1 - DOUBLE_TAP_SCALE), -limitX, limitX);
      const nextTy = clamp((e.y - cy) * (1 - DOUBLE_TAP_SCALE), -limitY, limitY);
      scale.set(withTiming(DOUBLE_TAP_SCALE));
      tx.set(withTiming(nextTx));
      ty.set(withTiming(nextTy));
      savedTx.set(nextTx);
      savedTy.set(nextTy);
      runOnJS(reportZoom)(true);
    });

  // Single tap = the page-turn / chrome zones. Off while zoomed (a tap there does
  // nothing, matching the pan-only behaviour) and during `suspended`. Exclusive
  // with `doubleTap` so it waits to make sure a second tap isn't coming.
  const singleTap = Gesture.Tap()
    .enabled(!zoomed && !suspended)
    .numberOfTaps(1)
    .maxDuration(300)
    .onEnd((e) => {
      runOnJS(onTapNav)(e.x);
    });

  const gesture = Gesture.Simultaneous(
    pinch,
    pan,
    contentPan,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));
  const contentPanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: contentTy.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width, height }]}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <Animated.View style={[{ width }, contentPanStyle]}>
            <ReaderPage
              uri={uri}
              page={page}
              fit={pageFit === 'fit-width' ? 'width' : 'contain'}
              width={width}
              height={height}
              onLoadDims={onLoadDims}
              onFailedChange={setPageFailed}
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
