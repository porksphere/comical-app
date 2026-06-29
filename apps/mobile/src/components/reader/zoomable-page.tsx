import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ReaderPage } from '@/components/reader/reader-page';

// A single paged-reader page with pinch-to-zoom, pan-while-zoomed and
// double-tap-to-toggle. Single taps keep the reader's tap-zone behaviour
// (left/right page turn, centre toggles chrome) while at 1×; once zoomed in a
// tap just toggles chrome and the parent locks the horizontal pager so the pan
// drives the image instead of turning pages.

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
// Below this we treat the page as "not zoomed" (and snap back to a clean 1×).
const ZOOM_EPSILON = 1.01;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

type Props = {
  uri: string;
  page: number;
  width: number;
  height: number;
  /** Whether this is the page currently in view; losing focus resets the zoom. */
  active: boolean;
  onLeft: () => void;
  onRight: () => void;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
};

export function ZoomablePage({
  uri,
  page,
  width,
  height,
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

  const [zoomed, setZoomed] = useState(false);

  const reportZoom = useCallback(
    (next: boolean) => {
      setZoomed(next);
      onZoomChange(next);
    },
    [onZoomChange],
  );

  const reset = useCallback(
    (animated: boolean) => {
      scale.value = animated ? withTiming(1) : 1;
      tx.value = animated ? withTiming(0) : 0;
      ty.value = animated ? withTiming(0) : 0;
      savedTx.value = 0;
      savedTy.value = 0;
      reportZoom(false);
    },
    [scale, tx, ty, savedTx, savedTy, reportZoom],
  );

  // Swiping to another page (or jumping via the progress pill) drops the zoom so
  // every page starts fit-to-screen.
  useEffect(() => {
    if (!active && zoomed) reset(false);
  }, [active, zoomed, reset]);

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      // Snapshot where the pinch began and the transform at that moment.
      focalStartX.value = e.focalX;
      focalStartY.value = e.focalY;
      baseScale.value = scale.value;
      baseTx.value = tx.value;
      baseTy.value = ty.value;
    })
    .onUpdate((e) => {
      const cx = width / 2;
      const cy = height / 2;
      const nextScale = clamp(baseScale.value * e.scale, 1, MAX_SCALE);
      // Content point (relative to centre, in unscaled px) that sat under the
      // fingers when the pinch started. Keeping it under the *current* finger
      // position anchors the zoom and lets a two-finger drag pan at the same
      // time — all from fixed base values, so nothing drifts frame to frame.
      const anchorX = (focalStartX.value - cx - baseTx.value) / baseScale.value;
      const anchorY = (focalStartY.value - cy - baseTy.value) / baseScale.value;
      const limitX = ((nextScale - 1) * width) / 2;
      const limitY = ((nextScale - 1) * height) / 2;
      tx.value = clamp(e.focalX - cx - nextScale * anchorX, -limitX, limitX);
      ty.value = clamp(e.focalY - cy - nextScale * anchorY, -limitY, limitY);
      scale.value = nextScale;
    })
    .onEnd(() => {
      if (scale.value <= ZOOM_EPSILON) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(reportZoom)(false);
        return;
      }
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      runOnJS(reportZoom)(true);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onStart(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    })
    .onUpdate((e) => {
      const limitX = ((scale.value - 1) * width) / 2;
      const limitY = ((scale.value - 1) * height) / 2;
      tx.value = clamp(savedTx.value + e.translationX, -limitX, limitX);
      ty.value = clamp(savedTy.value + e.translationY, -limitY, limitY);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((e) => {
      if (scale.value > ZOOM_EPSILON) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(reportZoom)(false);
        return;
      }
      // Zoom in centred on the tapped point so it stays under the finger.
      const limitX = ((DOUBLE_TAP_SCALE - 1) * width) / 2;
      const limitY = ((DOUBLE_TAP_SCALE - 1) * height) / 2;
      const nextX = clamp(-(e.x - width / 2) * (DOUBLE_TAP_SCALE - 1), -limitX, limitX);
      const nextY = clamp(-(e.y - height / 2) * (DOUBLE_TAP_SCALE - 1), -limitY, limitY);
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      tx.value = withTiming(nextX);
      ty.value = withTiming(nextY);
      savedTx.value = nextX;
      savedTy.value = nextY;
      runOnJS(reportZoom)(true);
    });

  // Single tap: tap zones at 1×, chrome toggle while zoomed.
  const singleTap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((e) => {
      if (scale.value > ZOOM_EPSILON) {
        runOnJS(onToggleChrome)();
        return;
      }
      if (e.x < width * 0.4) runOnJS(onLeft)();
      else if (e.x > width * 0.6) runOnJS(onRight)();
      else runOnJS(onToggleChrome)();
    });

  const gesture = Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // On web the browser's own pinch-zoom otherwise fights the gesture handler and
  // makes the page jump. `pan-x` keeps single-finger swipe-to-turn-page working
  // while disabling browser pinch-zoom (so the pinch reaches us); once zoomed,
  // `none` hands every touch to us so the pan can move the image freely.
  const webTouchAction: ViewStyle | null =
    Platform.OS === 'web'
      ? ({ touchAction: zoomed ? 'none' : 'pan-x' } as unknown as ViewStyle)
      : null;

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width, height }, webTouchAction]}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <ReaderPage uri={uri} page={page} fit="contain" width={width} height={height} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  page: {
    overflow: 'hidden',
  },
});
