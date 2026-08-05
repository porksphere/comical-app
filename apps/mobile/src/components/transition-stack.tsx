import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { withLayoutContext } from 'expo-router';
import { withScreenTransitions } from 'react-native-screen-transitions';

/**
 * The root navigator, replacing `expo-router`'s own `Stack`.
 *
 * WHY NOT expo-router's: `withScreenTransitions` — which is what gives a screen custom,
 * gesture-driven, interpolator-based transitions — takes a navigator OBJECT
 * (`{ Navigator, Screen, Group }`). Expo Router's `Stack` isn't one: it's a plain component with
 * `.Screen`/`.Protected` hung off it and no `.Navigator`, so it cannot be wrapped through public
 * API. It does forward unknown props to the navigator underneath, so hand-passing the adapter's
 * `layout`/`screenLayout` would work mechanically — but those aren't exported, and reaching into
 * a library's internals to keep a wrapper is a worse trade than swapping the wrapper.
 *
 * WHY @react-navigation/native-stack and not the library's own: `react-native-screen-transitions`
 * bundles a native-stack, and it is DEPRECATED — its own source says to use
 * `@react-navigation/native-stack` (or Expo Router's) with `withScreenTransitions` instead. This
 * is the supported combination, and the one they'll keep.
 *
 * WHAT THIS COSTS: expo-router's `Stack` is a fork carrying `Stack.Protected`, link previews,
 * route preloading, the (alpha) Apple zoom transition, and a custom stack-router override with
 * its own singular-route/dedup semantics. The app uses none of the first four — checked, not
 * assumed. The router override is the real behavioral delta: pushes now follow React Navigation's
 * stock `StackRouter`. Nothing in the app depends on the fork's dedup today (every push either
 * carries distinct params or is guarded by `lib/nav-guard`), but that's the thing to watch if a
 * navigation oddity shows up.
 *
 * Screens opt into a custom transition with `enableTransitions` + a `screenStyleInterpolator`;
 * everything else keeps stock native-stack behavior, so this file is a no-op for every route that
 * doesn't ask for more.
 */
const TransitionNavigator = withScreenTransitions(createNativeStackNavigator());

export const Stack = withLayoutContext(TransitionNavigator.Navigator);
