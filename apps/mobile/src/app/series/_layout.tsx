import { Stack } from 'expo-router';

import { InSeriesPageStack } from '@/lib/series-nav';

// The series page is a CONTAINED TRANSPARENT MODAL (see the root layout), and
// react-native-screens cannot push a plain root-stack card on top of a transparent modal — it
// presents as a bottom sheet instead of a page. So the modal hosts its OWN native stack: the
// combined page is `index` (transparent content — its dismissal fade must reveal the screen
// beneath the modal), and the download sub-pages have twin routes INSIDE this stack — real
// native pushes, with the slide-from-right animation and the native left-edge swipe back.
// `useSeriesSubPath` (lib/series-nav.ts) is what routes those pushes here instead of to the root
// routes. (Tag/author/type SEARCH is not a route anymore: it opens as an in-screen LAYER on the
// index screen — see SearchLayer in index.tsx / useOpenSearchLayer.)
//
// A series opened FROM a series (related rails, nested search results) is NOT a route at all:
// it renders as a sibling LAYER inside the index screen, which keeps the parent series live
// beneath it for its dismissal gestures — see SeriesReaderScreen in index.tsx; cards reach its
// layer-push through registerDrillSeries via useDrillRelatedSeries, gated by this context.
export default function SeriesReaderLayout() {
  return (
    <InSeriesPageStack.Provider value={true}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="index"
          options={{
            contentStyle: { backgroundColor: 'transparent' },
            // The stack ROOT has nothing to pop natively, but on iOS the UINavigationController's
            // edge-pop recognizers still sit over it and swallow left-edge touches before the
            // page's own edge back-swipe rig (which dismisses the modal / pops a drilled layer)
            // ever sees them. Disabled here; the sub-pages keep their own native gesture.
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="series-downloads" />
        <Stack.Screen name="downloads" />
      </Stack>
    </InSeriesPageStack.Provider>
  );
}
