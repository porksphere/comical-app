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

import { useManagesBar } from '@/components/bar-scrolled';
import { BarContentGap } from '@/constants/theme';
import { useNativeHeaderHeight } from '@/hooks/use-native-header';
import { useTheme } from '@/hooks/use-theme';
import { logDiagnostic } from '@/lib/diagnostics';
import { HIDDEN_TOP_EDGE, SLIDE_AWAY_BAR, useBarMaterial } from '@/lib/native-bar';

import { NavBarFade } from '../../../modules/nav-bar-fade';

/**
 * The series details' system bar on iOS, through the route's options. The content scrolls under it,
 * and it slides away while that happens, like every pushed page's (SLIDE_AWAY_BAR).
 *
 * Over the strip it is bare, with the page's own title below it (InlineSeriesTitle). The series'
 * title fades in, centred, as the page's own goes under the bar, following the scroll, the way
 * UIKit brings in an inline title under a large one. It is a custom title view that is always
 * there at some opacity, never an option: UIKit draws a blank or whitespace title as quotation
 * marks, a bar with nothing collapses to no height where the back button sits in the Duo's
 * vertical bar, and a text title is registered with the list's scroll edge, which every page
 * here keeps hidden. The frosted material still switches as an option, once the page's title is
 * past, and only on the way back up (scrolling down the bar is sliding away anyway);
 * `nav-bar-fade` crossfades it. The list's edge is this bar's to keep hidden (`useManagesBar`
 * with no reports), since the bar switches at its own line, not the list's top.
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
  const barBottom = useNativeHeaderHeight();
  const [pastTitle, setPastTitle] = useState(false);
  useManagesBar(true, 'bar');
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
  // One style object: expo-router's Slot, which `Stack.Title asChild` clones through, rejects an
  // array in development.
  const titleFade = useAnimatedStyle(() => ({
    ...TITLE_STYLE,
    color: theme.text,
    maxWidth: width * TITLE_MAX_WIDTH,
    opacity: interpolate(
      scrollOffset.value,
      [titleTop, titleTop + Math.max(inlineTitleHeight.value, 1)],
      [0, 1],
      'clamp',
    ),
  }));
  // TEMPORARY: the bar's switches, traced to Settings > Diagnostics (docs/NATIVE-HACKS.md, item 22).
  useEffect(() => {
    logDiagnostic('bar-fade', `series: past title ${pastTitle}`);
  }, [pastTitle]);
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
          scrollEdgeEffects: HIDDEN_TOP_EDGE,
        }}
      />
      <Stack.Title asChild>
        <Animated.Text numberOfLines={1} style={titleFade}>
          {title}
        </Animated.Text>
      </Stack.Title>
      {NavBarFade ? <NavBarFade style={styles.probe} pointerEvents="none" onTrace={traceBar} /> : null}
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
// UIKit's inline navigation title: 17pt semibold in the system font.
const TITLE_STYLE = { fontSize: 17, fontWeight: '600' } as const;

// TEMPORARY: the bar's switches, traced to Settings > Diagnostics (docs/NATIVE-HACKS.md, item 22).
function traceBar(e: { nativeEvent: { message: string } }) {
  logDiagnostic('bar-fade', e.nativeEvent.message);
}

const styles = StyleSheet.create({
  probe: { position: 'absolute', width: 0, height: 0 },
});
