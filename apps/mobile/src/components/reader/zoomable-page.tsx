import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ReaderPage } from '@/components/reader/reader-page';
import { useZoomable } from '@/components/reader/use-zoomable';
import type { PageFit } from '@/hooks/use-reader-settings';
import { ReaderTranslationOverlay } from '@/translation/components/reader-translation-overlay';

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
// with pinch-zoom — see `contentPan`). `pageFit === 'fit-page'` shows the whole
// page, letterboxed, still pinch-zoomable.

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

  // Compounding pinch's scale/anchor math with an independent content-pan offset
  // is a correctness trap, so the two are made mutually exclusive: zoom is
  // disabled exactly when `contentPan` would be enabled. Zoom is also off while
  // the page shows its failed/Retry state so a tap reaches the Retry chip.
  const zoomEnabled = !(pageFit === 'fit-width' && overflowsVertically) && !pageFailed;
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
    .enabled(pageFit === 'fit-width' && overflowsVertically)
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

  // The whole zoom gesture (pinch / double-tap / one-finger pan / the tap zones,
  // all composed) comes from the shared hook; this page just feeds it the tap-zone
  // handler and its content-pan.
  const { gesture, animatedStyle, zoomed, reset } = useZoomable({
    width,
    height,
    enabled: zoomEnabled,
    onZoomChange,
    onSingleTap: onTapNav,
    singleTapEnabled: !suspended,
    extraSimultaneous: [contentPan],
  });

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
            {/* Inside the zoom + content-pan transforms, so bubbles track the page 1:1. */}
            <ReaderTranslationOverlay
              pageKey={uri}
              width={width}
              height={height}
              fit={pageFit === 'fit-width' ? 'width' : 'contain'}
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
