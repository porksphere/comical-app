import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { settingsScreen } from '@/lib/native-bar';
import { InSeriesPageStack, NESTED_SEARCH_BAR } from '@/lib/series-nav';

// The series page is a CONTAINED TRANSPARENT MODAL (see the root layout), and
// react-native-screens cannot push a plain root-stack card on top of a transparent modal — it
// presents as a bottom sheet instead of a page. So the modal hosts its OWN native stack: the
// details page is `index` (transparent content — its dismissal fade must reveal the screen
// beneath the modal), and the download sub-pages have twin routes INSIDE this stack — real
// native pushes, with the slide-from-right animation and the native left-edge swipe back.
// `useSeriesSubPath` (lib/series-nav.ts) is what routes those pushes here instead of to the root
// routes. The tag/author/type SEARCH is one of them on iOS — `search`, pushed by
// useOpenSeriesSearch, the one sub-page that shows the system bar (its field lives there);
// Android and web open the same search as an in-screen LAYER on the index screen instead (see
// SearchLayer in index.tsx), the layer being how the custom chevron stays put across the slide.
//
// The READER is a page of its own, `read`, pushed over the details (`index`) — see SeriesSplit in
// index.tsx. On iOS it is a plain native push, and either page may be the stack's first: a link
// that opens reading lands on `read`, whose Details push `index` over it. Only that first page
// is the modal's, with its zoom from the card (see useNativePush). Elsewhere it is a TRANSPARENT
// modal with no animation: the details stay rendered beneath it (a native stack hides the screen under a plain
// card, on web with display: none), because the reader grows OUT of the details' strip and shrinks
// back into it, both drawn by the page itself.
//
// A series opened FROM a series (related rails, nested search results) is NOT a route at all:
// it renders as a sibling LAYER inside the screen it was opened from, which keeps the parent series live
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
            // Off iOS a reader page REPLACED by its details draws its own reveal (SeriesSplit).
            ...(Platform.OS === 'ios' ? null : { animation: 'none' as const }),
          }}
        />
        <Stack.Screen name="read" options={Platform.OS === 'ios' ? undefined : READ_OVER_DETAILS} />
        <Stack.Screen name="series-downloads" options={settingsScreen('Downloads')} />
        <Stack.Screen name="downloads" options={settingsScreen('Downloads')} />
        <Stack.Screen name="search" options={NATIVE_HEADER ? NESTED_SEARCH_BAR : undefined} />
      </Stack>
    </InSeriesPageStack.Provider>
  );
}

const READ_OVER_DETAILS = {
  presentation: 'transparentModal',
  animation: 'none',
  contentStyle: { backgroundColor: 'transparent' },
} as const;
