import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useBarScrolled, useManagesBar } from '@/components/bar-scrolled';
import { HoldActionTarget } from '@/components/hold-action-target';
import type { TabFilter } from '@/components/tab-filter';
import { useTheme } from '@/hooks/use-theme';
import { logDiagnostic } from '@/lib/diagnostics';
import { HIDDEN_TOP_EDGE, useBarMaterial, useFoldedBarEdge } from '@/lib/native-bar';

import { NavBarFade } from '../../modules/nav-bar-fade';

// A section label's arrival in the bar, and the bar's hand-back to the screen title.
const SWAP_MS = 180;

/**
 * The iOS native navigation bar for a tab screen whose only control is the filter: the title, and
 * the filter as the system search item. Rendered INSTEAD of TabTitleBar when NATIVE_HEADER — it
 * draws nothing itself, it only sets the screen's header options.
 *
 * The title is the bar's inline one, and it stays: the bar itself slides away as the list scrolls
 * down and back as it scrolls up (iOS 27 bar minimization, `SLIDE_AWAY_BAR` in lib/native-bar), the
 * way Settings' pages do. A custom title view (`asChild`) so it can cross-fade and take a hold; the
 * text is set to the system's inline title metrics so at rest it is indistinguishable from one.
 *
 * With `section` the bar also names the content under it, the way Photos names the month and
 * Music the album: once a section heading has scrolled under the bar the screen reports its label
 * (StickySectionHeader's `onActiveChange`), and that label takes the title's place, swapping on a
 * short cross-fade as the next heading arrives. Nothing pins under the native bar — this is where
 * the pinned heading went.
 *
 * The search bar is the integrated-button placement: a magnifier among the trailing items that
 * expands into the field on tap (iOS 26; an inline field under the title before that). Cancel
 * clears the query, which is what closing the custom field does too.
 *
 * The title is also the tab's NSFW hold target (`HoldActionTarget`), on every tab: the bar holds
 * only system items, and a UIBarButtonItem has no long-press of its own; holding one only ever
 * opens its menu.
 */
export function NativeTabHeader({
  title,
  section,
  filter,
  placeholder,
  holdTestID,
}: {
  title: string;
  /** The label of the section heading scrolled under the bar, null above the first. */
  section?: string | null;
  filter?: TabFilter;
  placeholder?: string;
  holdTestID: string;
}) {
  const theme = useTheme();
  // The bar is bare over the top of the page and takes its material once the list is under it,
  // the series page's way, with `nav-bar-fade` crossfading the switch — see `bar-scrolled.tsx`.
  const scrolled = useBarScrolled();
  useManagesBar();
  // TEMPORARY: each change to Settings > Diagnostics, until the bar's rest state is confirmed.
  useEffect(() => {
    logDiagnostic('bar-fade', `${title}: scrolled ${scrolled}`);
  }, [title, scrolled]);
  const material = useBarMaterial();
  const foldedEdge = useFoldedBarEdge();
  const shown = section ?? title;
  // Re-runs 0→1 on every change of the shown text: the cross-fade between labels.
  const arrival = useSharedValue(1);
  const [prev, setPrev] = useState(shown);
  if (prev !== shown) {
    setPrev(shown);
    arrival.set(0);
    arrival.set(withTiming(1, { duration: SWAP_MS }));
  }
  const fade = useAnimatedStyle(() => ({ opacity: arrival.value }));
  return (
    <>
      <Stack.Screen options={{ headerBlurEffect: scrolled ? material : 'none', scrollEdgeEffects: HIDDEN_TOP_EDGE }} />
      {NavBarFade ? (
        <NavBarFade
          style={styles.probe}
          pointerEvents="none"
          edgeBacked={foldedEdge != null && scrolled}
          // TEMPORARY: each switch to Settings > Diagnostics, until the fade is confirmed on a device.
          onTrace={(e) => logDiagnostic('bar-fade', `${title}: ${e.nativeEvent.message}`)}
        />
      ) : null}
      <Stack.Title asChild>
        <HoldActionTarget testID={holdTestID} label={title}>
          <Animated.Text numberOfLines={1} style={[styles.title, { color: theme.text }, fade]}>
            {shown}
          </Animated.Text>
        </HoldActionTarget>
      </Stack.Title>
      {filter ? (
        <Stack.SearchBar
          placeholder={placeholder}
          placement="integratedButton"
          onChangeText={(e) => filter.setQuery(e.nativeEvent.text)}
          onCancelButtonPress={filter.close}
        />
      ) : null}
    </>
  );
}

/** UIKit's inline navigation title: 17pt semibold in the system font, for a custom title view
 *  that is to be indistinguishable from the system's at rest. */
export const barTitleStyle = StyleSheet.create({
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
}).title;

const styles = StyleSheet.create({
  title: barTitleStyle,
  probe: {
    width: 0,
    height: 0,
  },
});
