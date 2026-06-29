import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ReaderPage } from '@/components/reader/reader-page';

// A single paged-reader page (NATIVE only — web has its own gesture pager in
// paged-reader.web.tsx and never renders this).
//
// Navigation is plain Pressable tap zones (left/right turn, centre toggles
// chrome) so taps fire immediately and a one-finger drag falls through to the
// FlatList for swiping. A GestureDetector adds pinch-to-zoom and pan-while-
// zoomed; react-native-gesture-handler coexists with the FlatList on native.

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

function TapZones({
  zoomed,
  onLeft,
  onRight,
  onToggleChrome,
}: {
  zoomed: boolean;
  onLeft: () => void;
  onRight: () => void;
  onToggleChrome: () => void;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.zones]} pointerEvents={zoomed ? 'none' : 'auto'}>
      <Pressable style={styles.side} onPress={onLeft} />
      <Pressable style={styles.center} onPress={onToggleChrome} />
      <Pressable style={styles.side} onPress={onRight} />
    </View>
  );
}

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

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width, height }]}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <ReaderPage uri={uri} page={page} fit="contain" width={width} height={height} />
        </Animated.View>
        <TapZones zoomed={zoomed} onLeft={onLeft} onRight={onRight} onToggleChrome={onToggleChrome} />
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
