import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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

function TapZones({
  zoomed,
  suspended,
  onLeft,
  onRight,
  onToggleChrome,
}: {
  zoomed: boolean;
  /** True while the page is showing its failed/Retry state — suspends these
   *  zones so a tap reaches the Retry chip instead of turning the page. */
  suspended: boolean;
  onLeft: () => void;
  onRight: () => void;
  onToggleChrome: () => void;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.zones, { pointerEvents: zoomed || suspended ? 'none' : 'auto' }]}>
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
      contentHeight.value = ch;
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

  // Same for content-pan: a page left behind always comes back scrolled to the top.
  useEffect(() => {
    if (!active) {
      contentTy.value = 0;
      savedContentTy.value = 0;
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
      savedContentTy.value = contentTy.value;
      runOnJS(setContentPanning)(true);
    })
    .onUpdate((e) => {
      const maxOffset = Math.max(0, contentHeight.value - height);
      contentTy.value = clamp(savedContentTy.value + e.translationY, -maxOffset, 0);
    })
    .onEnd(() => {
      savedContentTy.value = contentTy.value;
      runOnJS(setContentPanning)(false);
    });

  const gesture = Gesture.Simultaneous(pinch, pan, contentPan);

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
        <TapZones
          zoomed={zoomed}
          suspended={pageFailed || contentPanning}
          onLeft={onLeft}
          onRight={onRight}
          onToggleChrome={onToggleChrome}
        />
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
