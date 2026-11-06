import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useHoldAction } from '@/components/hold-action-target';
import type { TabFilter } from '@/components/tab-filter';
import { HIDDEN_TOP_EDGE } from '@/lib/native-bar';
import { NavBarHold } from '../../modules/nav-bar-hold';
import { NavBarLargeTitle } from '../../modules/nav-bar-large-title';

/**
 * The iOS native navigation bar for a tab screen, Photos' tab bar: the system large title on
 * the bar's own row at the leading edge, its items at the trailing edge, bare over the top of
 * the page and over the frosted material once content is under it (the bar's scroll-edge
 * appearance against its standard one, switched by UIKit on the list the screen hands it). The
 * whole bar slides away as the list scrolls down and comes back, title and material together, as
 * soon as it scrolls up (iOS 27 bar minimization, `SLIDE_AWAY_BAR`). Rendered INSTEAD of
 * TabTitleBar when NATIVE_HEADER — it draws nothing itself, it only sets the screen's header
 * options and places two zero-size views.
 *
 * The title is UIKit's large title in its `inline` mode (the local `nav-bar-large-title` module;
 * react-native-screens only knows `always`, a row of its own under the items that collapses into
 * the inline title on scroll), so it never collapses and the bar keeps one height. The system's
 * own soft scroll edge is hidden: the material is the backing.
 *
 * The title is the screen's NSFW hold target as well: UIKit's text, with nothing of ours to take
 * the gesture, so the local `nav-bar-hold` module reads the bar's touches on it and reports the
 * press and its end to the same ramped hold the custom bars' marks run, and swells the title's
 * label with each of the ramp's beats, as the marks' pulse does.
 *
 * The search bar is the integrated-button placement: a magnifier among the trailing items that
 * expands into the field on tap (iOS 26; an inline field under the title before that). Cancel
 * clears the query, which is what closing the custom field does too.
 */
export function NativeTabHeader({ title, filter, placeholder }: { title: string; filter?: TabFilter; placeholder?: string }) {
  return (
    <>
      <Stack.Screen
        options={{ title, headerLargeTitleEnabled: true, headerLargeStyle: BARE_AT_TOP, scrollEdgeEffects: HIDDEN_TOP_EDGE }}
      />
      {filter ? (
        <Stack.SearchBar
          placeholder={placeholder}
          placement="integratedButton"
          onChangeText={(e) => filter.setQuery(e.nativeEvent.text)}
          onCancelButtonPress={filter.close}
        />
      ) : null}
      {NavBarLargeTitle ? <NavBarLargeTitle mode="inline" style={styles.pin} pointerEvents="none" /> : null}
      {NavBarHold ? <TitleHold /> : null}
    </>
  );
}

/**
 * The hold on the title, its beats handed back to the bar as a swell of the title's label: its
 * own component, so each beat's render stays off the screen options above it.
 */
function TitleHold() {
  const [pulse, setPulse] = useState({ seq: 0, amount: 0 });
  const hold = useHoldAction((amount) => setPulse((prev) => ({ seq: prev.seq + 1, amount })));
  if (!NavBarHold || !hold.enabled) return null;
  return (
    <NavBarHold
      style={styles.pin}
      pointerEvents="none"
      pulseSeq={pulse.seq}
      pulseAmount={pulse.amount}
      onHold={(e) => (e.nativeEvent.phase === 'begin' ? hold.onPressIn() : hold.onPressOut())}
    />
  );
}

// A transparent large-title background is the bar's scroll-edge appearance with no backing at
// all: bare at the top of the list, the standard appearance's material once scrolled.
const BARE_AT_TOP = { backgroundColor: 'transparent' } as const;

/** UIKit's inline navigation title: 17pt semibold in the system font, for a custom title view
 *  that is to be indistinguishable from the system's at rest. */
export const barTitleStyle = StyleSheet.create({
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
}).title;

const styles = StyleSheet.create({
  pin: { position: 'absolute', width: 0, height: 0 },
});
