import { Slot, Stack } from 'expo-router';

import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { InSeriesPageStack } from '@/lib/series-nav';

/**
 * The layout of a tab's series copy (`app/(tabs)/<tab>/series/`, iOS — see `tab-stack`): the same
 * nested stack the root `/series` directory hosts (`app/series/_layout`), with only the combined
 * page in it. Not for sub-pages — from an in-tab series those still go to the root routes (see
 * `useSeriesSubPath`) — but for the page's system bar: the route itself is a contained transparent
 * modal, and on iOS react-native-screens remounts a modal's content whenever its `headerShown`
 * flips (`ScreenStackItem`'s header-in-modal wrap). The series page flips it on every details ⇄
 * reader switch and for its search layer, so its `Stack.Screen` must address a PUSHED screen: this
 * stack's `index`, where a header toggle is just a header toggle.
 *
 * Provides `InSeriesPageStack` like the root layout does, so the page's cards and search layer
 * drill as layers rather than pushing a second page.
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
        </Stack>
      ) : (
        <Slot />
      )}
    </InSeriesPageStack.Provider>
  );
}
