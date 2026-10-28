import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { HoldActionTarget, useHoldAction } from '@/components/hold-action-target';
import type { TabFilter } from '@/components/tab-filter';
import { useTheme } from '@/hooks/use-theme';
import { NavBarHold, type NavBarHoldPhase } from '../../modules/nav-bar-hold';

// The scroll over which the title goes: holds through a nudge, gone by about a bar's height.
const FADE_START = 8;
const FADE_END = 56;
// A section label's arrival in the bar, and the bar's hand-back to the screen title.
const SWAP_MS = 180;

/**
 * The iOS native navigation bar for a tab screen whose only control is the filter: the title, and
 * the filter as the system search item. Rendered INSTEAD of TabTitleBar when NATIVE_HEADER — it
 * draws nothing itself, it only sets the screen's header options.
 *
 * The title is the bar's inline one: it sits in the bar and fades out as the list scrolls down
 * (`scrollY`, the list's content offset), back in at the top — the bar stays one height, and the
 * heading is the content once you're into it. A custom title view (`asChild`) because the system
 * title has no opacity to drive; the text is set to the system's inline title metrics so at rest
 * it is indistinguishable from one.
 *
 * With `large` the screen takes the system large title as well, Notes' and Settings' heading:
 * UIKit's own 34pt text under the bar's row while the list is at the top, collapsing into the
 * row over the first scroll (it reads the list the screen handed it — `TabScrollMarker`'s
 * anchor — the hand-off the scrolled material needs anyway). The string comes from the screen's
 * `title` option, which the large title shows even beside a custom inline view; the inline view
 * is the SAME fading text, run the other way: hidden under the large title and arriving in the
 * row as the large title collapses, so the heading is never shown twice, and the section label
 * takes over from there as below. The content pads by the resting height, the expanded bar
 * (`useNativeHeaderHeight`), so the first scroll shrinks the bar and the content follows its
 * edge, as under a system large title.
 *
 * With `section` the bar also names the content under it, the way Photos names the month and
 * Music the album: once a section heading has scrolled under the bar the screen reports its label
 * (StickySectionHeader's `onActiveChange`), and that label stands in the faded title's place, at
 * full opacity regardless of the scroll, swapping on a short cross-fade as the next heading
 * arrives. Nothing pins under the native bar — this is where the pinned heading went.
 *
 * The search bar is the integrated-button placement: a magnifier among the trailing items that
 * expands into the field on tap (iOS 26; an inline field under the title before that). Cancel
 * clears the query, which is what closing the custom field does too.
 *
 * With `holdTestID` the title is also the screen's NSFW hold target (`HoldActionTarget`): Browse
 * keeps the gesture on its heading since its bar button is a system item, and a UIBarButtonItem
 * has no long-press of its own; holding one only ever opens its menu. The large title is
 * UIKit's text with nothing of ours in it, so while it is expanded the hold comes from the bar's
 * touches instead, through the local `nav-bar-hold` module (`NavBarHold`, a zero-size view in
 * the page), which reports a press on the large title's band and its end; the same ramp runs,
 * without the pulse, the text not being ours to swell.
 */
export function NativeTabHeader({
  title,
  scrollY,
  section,
  filter,
  placeholder,
  holdTestID,
  large = false,
}: {
  title: string;
  /** The screen's live scroll offset; without one the title simply stays. */
  scrollY?: SharedValue<number>;
  /** The label of the section heading scrolled under the bar, null above the first. */
  section?: string | null;
  filter?: TabFilter;
  placeholder?: string;
  holdTestID?: string;
  /** The system large title over the row, collapsing on scroll; the inline title then arrives
   *  as it goes instead of fading out. */
  large?: boolean;
}) {
  const theme = useTheme();
  const barHold = useHoldAction();
  const still = useSharedValue(0);
  const y = scrollY ?? still;
  const shown = section ?? title;
  // 1 while a section label holds the slot, 0 while the scroll-faded title does.
  const sectioned = useSharedValue(section ? 1 : 0);
  // Re-runs 0→1 on every change of the shown text: the cross-fade between labels.
  const arrival = useSharedValue(1);
  const [prev, setPrev] = useState(shown);
  if (prev !== shown) {
    setPrev(shown);
    sectioned.set(withTiming(section ? 1 : 0, { duration: SWAP_MS }));
    arrival.set(0);
    arrival.set(withTiming(1, { duration: SWAP_MS }));
  }
  const fade = useAnimatedStyle(() => {
    const scrolled = interpolate(y.value, [FADE_START, FADE_END], large ? [0, 1] : [1, 0], Extrapolation.CLAMP);
    const s = sectioned.value;
    return { opacity: arrival.value * (s + (1 - s) * scrolled) };
  });
  const text = (
    <Animated.Text numberOfLines={1} style={[styles.title, { color: theme.text }, fade]}>
      {shown}
    </Animated.Text>
  );
  const onBarHold = ({ nativeEvent }: { nativeEvent: { phase: NavBarHoldPhase } }) => {
    if (nativeEvent.phase === 'begin') barHold.onPressIn();
    else barHold.onPressOut();
  };
  return (
    <>
      {large ? <Stack.Screen options={{ title, headerLargeTitleShadowVisible: false }} /> : null}
      <Stack.Title asChild large={large} largeStyle={{ color: theme.text }}>
        {holdTestID ? (
          <HoldActionTarget testID={holdTestID} label={title}>
            {text}
          </HoldActionTarget>
        ) : (
          text
        )}
      </Stack.Title>
      {large && holdTestID && barHold.enabled && NavBarHold ? (
        <NavBarHold onHold={onBarHold} style={styles.pin} pointerEvents="none" />
      ) : null}
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

const styles = StyleSheet.create({
  // UIKit's inline navigation title: 17pt semibold in the system font.
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  pin: { position: 'absolute', width: 0, height: 0 },
});
