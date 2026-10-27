import { Slot, Stack } from 'expo-router';

import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { InSeriesPageStack, NESTED_SEARCH_BAR } from '@/lib/series-nav';

/**
 * The layout of a tab's series copy (`app/(tabs)/<tab>/series/`, iOS — see `tab-stack`): the same
 * nested stack the root `/series` directory hosts (`app/series/_layout`), with the combined page
 * and the tag search in it. Not for the download sub-pages — from an in-tab series those still go
 * to the root routes (see `useSeriesSubPath`) — but for the page's system bar: the route itself is a contained transparent
 * modal, and on iOS react-native-screens remounts a modal's content whenever its `headerShown`
 * flips (`ScreenStackItem`'s header-in-modal wrap). The series page flips it on every details ⇄
 * reader switch and for its search layer, so its `Stack.Screen` must address a PUSHED screen: this
 * stack's `index`, where a header toggle is just a header toggle.
 *
 * The tag search is here too (`search`, see `useOpenSeriesSearch`): pushed INTO this stack it
 * keeps the tab bar up and gets the system bar for its field, which the series page's own
 * contained modal could never push over itself.
 *
 * Provides `InSeriesPageStack` like the root layout does, so the page's cards (and the nested
 * search's result cards) drill as layers rather than pushing a second page.
 */
export default function TabSeriesStack() {
  return (
    <InSeriesPageStack.Provider value={true}>
      {NATIVE_HEADER ? (
        <Stack
          screenOptions={{
            headerShown: false,
            headerTransparent: true,
            headerShadowVisible: false,
            scrollEdgeEffects: { top: 'soft' },
          }}>
          <Stack.Screen
            name="index"
            options={{
              contentStyle: { backgroundColor: 'transparent' },
              // As in app/series/_layout: nothing to pop natively, and the controller's edge-pop
              // recognizers would swallow the page's own edge back-swipe.
              gestureEnabled: false,
            }}
          />
          <Stack.Screen name="search" options={NESTED_SEARCH_BAR} />
        </Stack>
      ) : (
        <Slot />
      )}
    </InSeriesPageStack.Provider>
  );
}
