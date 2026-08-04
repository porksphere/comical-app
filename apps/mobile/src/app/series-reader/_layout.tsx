import { Stack } from 'expo-router';

import { InSeriesReaderStack } from '@/lib/experimental-flags';

// EXPERIMENTAL series reader page: the combined page is a CONTAINED TRANSPARENT MODAL (see the
// root layout), and react-native-screens cannot push a plain root-stack card on top of a
// transparent modal — it presents as a bottom sheet instead of a page. So the modal hosts its
// OWN native stack: the combined page is `index` (transparent content — its dismissal fade must
// reveal the screen beneath the modal), and every sub-page the details can push (tag/author/type
// search, the download screens) has a twin route INSIDE this stack — real native pushes, with
// the slide-from-right animation and the native left-edge swipe back. `useSeriesSubPath`
// (lib/experimental-flags.ts) is what routes those pushes here instead of to the root routes.
//
// `related` is the same combined page again, for series opened FROM a series (related rails, or
// result cards on the nested search): an ordinary opaque card in this stack, NOT a second
// transparent modal — stacking two contained transparent modals loses the middle screen's view
// on iOS (see InSeriesReaderStack, whose provider here is how the cards know to drill).
// Remove with the experiment — see index.tsx for the full removal list.
export default function SeriesReaderLayout() {
  return (
    <InSeriesReaderStack.Provider value={true}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="related" />
        <Stack.Screen name="search" />
        <Stack.Screen name="series-downloads" />
        <Stack.Screen name="downloads" />
      </Stack>
    </InSeriesReaderStack.Provider>
  );
}
