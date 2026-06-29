import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ReaderPage } from '@/components/reader/reader-page';

// A single paged-reader page with pinch-to-zoom and pan-while-zoomed.
//
// Navigation stays on plain Pressable tap zones (left/right turn, centre toggles
// chrome) exactly like the non-zoom reader: taps fire immediately and a
// one-finger horizontal drag falls through to the FlatList so swiping still
// turns pages. The gesture detector only handles pinch (two-finger, so it never
// captures a one-finger swipe) and, once zoomed, a one-finger pan to move the
// image. While zoomed the parent locks the pager and the tap zones go inert.

const MAX_SCALE = 4;
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

  const reset = useCallback(() => {
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
    reportZoom(false);
  }, [scale, tx, ty, savedTx, savedTy, reportZoom]);

  // Swiping to another page (or jumping via the progress pill) drops the zoom so
  // every page starts fit-to-screen.
  useEffect(() => {
    if (!active && zoomed) reset();
  }, [active, zoomed, reset]);

  const pinch = Gesture.Pinch()
    .onStart((e) => {
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
      // fingers when the pinch started; keep it under the current finger
      // position so the zoom anchors and a two-finger drag also pans.
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

  // One-finger pan, only while zoomed (so it never steals a swipe at 1×).
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

  const gesture = Gesture.Simultaneous(pinch, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // While zoomed, hand all touches to the gesture handler so the pan isn't
  // interrupted by the browser; at 1× allow horizontal panning so the pager can
  // still be swiped on web.
  const webTouchAction: ViewStyle | null =
    Platform.OS === 'web'
      ? ({ touchAction: zoomed ? 'none' : 'pan-x pan-y' } as unknown as ViewStyle)
      : null;

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width, height }, webTouchAction]}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <ReaderPage uri={uri} page={page} fit="contain" width={width} height={height} />
        </Animated.View>
        {/* Tap zones for navigation, inert while zoomed (pan owns the touches). */}
        <View style={[StyleSheet.absoluteFill, styles.zones]} pointerEvents={zoomed ? 'none' : 'auto'}>
          <Pressable style={styles.side} onPress={onLeft} />
          <Pressable style={styles.center} onPress={onToggleChrome} />
          <Pressable style={styles.side} onPress={onRight} />
        </View>
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
    flex: 4, // ~40%
  },
  center: {
    flex: 2, // ~20%
  },
});
