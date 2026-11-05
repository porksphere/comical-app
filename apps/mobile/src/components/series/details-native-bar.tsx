import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { useManagesBar, useReportBarScrolled } from '@/components/bar-scrolled';
import { BarContentGap } from '@/constants/theme';
import { useNativeHeaderHeight } from '@/hooks/use-native-header';
import { useTheme } from '@/hooks/use-theme';
import { logDiagnostic } from '@/lib/diagnostics';
import { HIDDEN_TOP_EDGE, SLIDE_AWAY_BAR, useBarMaterial, useFoldedBarEdge } from '@/lib/native-bar';

import { NavBarFade } from '../../../modules/nav-bar-fade';

/**
 * The series details' system bar on iOS, through the route's options. The content scrolls under it,
 * and it slides away while that happens, like every pushed page's (SLIDE_AWAY_BAR).
 *
 * Over the strip it is bare, with the page's own title below it. The series' title fades in as the
 * page's own goes under the bar, following the scroll, the way UIKit brings in an inline title under
 * a large one. It is a custom title view that is always there at some opacity, never an option:
 * - Options apply unanimated, through a whole header update.
 * - A plain-text title gets a backing from the system's scroll edge, a blank one included.
 * - Where the back button sits in the Duo's vertical bar, a bar with no title has nothing in it and
 *   collapses to no height, so a first title grew it from nothing in one frame.
 * The frosted material still switches as an option, once the page's title is past, and only on the
 * way back up (scrolling down the bar is sliding away anyway); `nav-bar-fade` crossfades it. UIKit's
 * own crossfade, a transparent scroll-edge appearance over the frosted standard one, never ran on a
 * device. On the folded Duo there is no material: the backing is the scroll view's hard top edge, as
 * on every page there, but UIKit draws an edge only behind what the bar registers, and a custom
 * title view isn't, so `nav-bar-fade` registers it once the page's title is past. The edge itself
 * comes and goes with the title too (`bar-scrolled`, the list's anchor applying it): at rest over
 * the strip a hard edge drew a band behind the bar's empty items, which went as the bar slid away.
 *
 * The title is an option change like any other, so it is its own component and a crossing
 * re-renders this much and no more. Options go through react-native-screens' whole header update,
 * which also rebuilds the bar's items, unanimated. A pushed card's back button is the system's and
 * isn't one of them.
 *
 *
 * Only the top instance mounts this (the options are the route's, shared by every layer), so a
 * layer that becomes top again re-applies them: Stack.Screen's effect runs on mount, and the toolbar
 * unregisters its item on unmount. Inside a tab the route is the tab stack's own pushed card
 * (useNativePush), whose back button is the system's, the one the tab's leading item morphs into. At
 * the root the route these options reach is the `index` of the nested stack (app/series/_layout),
 * never the contained transparent modal around it: react-native-screens remounts a modal's content
 * when its `headerShown` flips, as the search layer flips it; a nested root has no back of its own,
 * hence the toolbar chevron.
 */
export function SeriesDetailsNativeBar({
  title,
  nativePush,
  onClose,
  scrollOffset,
  contentTop,
  inlineTitleHeight,
}: {
  title: string;
  nativePush: boolean;
  onClose: () => void;
  scrollOffset: SharedValue<number>;
  /** Where the list's content starts, before its own gap: the height of the strip above it. */
  contentTop: number;
  inlineTitleHeight: SharedValue<number>;
}) {
  const material = useBarMaterial();
  const foldedEdge = useFoldedBarEdge();
  const barBottom = useNativeHeaderHeight();
  const [pastTitle, setPastTitle] = useState(false);
  // Folded, the list's edge is this bar's to switch, at the page's title, not at the list's top.
  useManagesBar(foldedEdge != null, 'bar');
  const report = useReportBarScrolled();
  useEffect(() => {
    if (foldedEdge) report?.(pastTitle);
  }, [foldedEdge, pastTitle, report]);
  const titled = useSharedValue(false);
  const titleTop = contentTop + BarContentGap - barBottom;
  useAnimatedReaction(
    () => scrollOffset.value,
    (offset, prev) => {
      const past = offset > titleTop + inlineTitleHeight.value;
      // A page that opens already scrolled past its title has a bar in view: title it straight away.
      const next = past ? titled.value || prev == null || offset < prev : false;
      if (next === titled.value) return;
      titled.value = next;
      runOnJS(setPastTitle)(next);
    },
    [titleTop],
  );
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const titleFade = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollOffset.value,
      [titleTop, titleTop + Math.max(inlineTitleHeight.value, 1)],
      [0, 1],
      'clamp',
    ),
  }));
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerBlurEffect: pastTitle ? material : 'none',
          headerBackVisible: nativePush,
          // Not a pushed card, nothing for UIKit to pop: the edge is the page's own back-swipe.
          gestureEnabled: nativePush,
          title,
          unstable_nativeProps: SLIDE_AWAY_BAR,
          // Folded, the edge is the anchor's to switch (above); a tab's stack would set the hard
          // edge on every screen, and the root's series stack sets none.
          ...(foldedEdge && { scrollEdgeEffects: HIDDEN_TOP_EDGE }),
        }}
      />
      <Stack.Title asChild>
        <Animated.Text
          numberOfLines={1}
          style={[styles.title, { color: theme.text, maxWidth: width * TITLE_MAX_WIDTH }, titleFade]}>
          {title}
        </Animated.Text>
      </Stack.Title>
      {NavBarFade ? (
        <NavBarFade
          style={styles.probe}
          pointerEvents="none"
          edgeBacked={foldedEdge != null && pastTitle}
          onTrace={traceBar}
        />
      ) : null}
      {!nativePush ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Go back" onPress={onClose} />
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

// What the bar leaves the title between its leading and trailing items.
const TITLE_MAX_WIDTH = 0.6;

// TEMPORARY: the bar's first pop in, traced to Settings > Diagnostics (docs/NATIVE-HACKS.md, item 22).
function traceBar(e: { nativeEvent: { message: string } }) {
  logDiagnostic('bar-fade', e.nativeEvent.message);
}

const styles = StyleSheet.create({
  probe: { position: 'absolute', width: 0, height: 0 },
  // UIKit's inline navigation title: 17pt semibold in the system font.
  title: { fontSize: 17, fontWeight: '600' },
});
