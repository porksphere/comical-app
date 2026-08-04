import { Stack } from 'expo-router';

// EXPERIMENTAL series reader page: the combined page is a CONTAINED TRANSPARENT MODAL (see the
// root layout), and react-native-screens cannot push a plain root-stack card on top of a
// transparent modal — it presents as a bottom sheet instead of a page. So the modal hosts its
// OWN native stack: the combined page is `index` (transparent content — its dismissal fade must
// reveal the screen beneath the modal), and every sub-page the details can push (tag/author/type
// search, the download screens) has a twin route INSIDE this stack — real native pushes, with
// the slide-from-right animation and the native left-edge swipe back. `useSeriesSubPath`
// (lib/experimental-flags.ts) is what routes those pushes here instead of to the root routes.
// Remove with the experiment — see index.tsx for the full removal list.
export default function SeriesReaderLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: 'transparent' } }} />
      <Stack.Screen name="search" />
      <Stack.Screen name="series-downloads" />
      <Stack.Screen name="downloads" />
    </Stack>
  );
}
