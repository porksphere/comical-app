import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import type { TabFilter } from '@/components/tab-filter';
import { HIDDEN_TOP_EDGE } from '@/lib/native-bar';

/**
 * The iOS native navigation bar for a tab screen: no title and no material, only its items, the
 * leading menu and the filter as the system search item, floating over the page the way an iOS 26
 * bar does. The tab's title is at the top of its list (`TabLargeTitle`), scrolling away with the
 * content. The bar slides away as the list scrolls down and back as it scrolls up (iOS 27 bar
 * minimization, `SLIDE_AWAY_BAR` in lib/native-bar). Rendered INSTEAD of TabTitleBar when
 * NATIVE_HEADER — it draws nothing itself, it only sets the screen's header options.
 *
 * The search bar is the integrated-button placement: a magnifier among the trailing items that
 * expands into the field on tap (iOS 26; an inline field under the title before that). Cancel
 * clears the query, which is what closing the custom field does too.
 */
export function NativeTabHeader({ filter, placeholder }: { filter?: TabFilter; placeholder?: string }) {
  return (
    <>
      <Stack.Screen options={{ title: '', headerBlurEffect: 'none', scrollEdgeEffects: HIDDEN_TOP_EDGE }} />
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
