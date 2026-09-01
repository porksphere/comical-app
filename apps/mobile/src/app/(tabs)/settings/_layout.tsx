import { Stack } from 'expo-router';

/**
 * Settings pushes INSIDE the tab slot, not over it.
 *
 * These were root-stack screens, which meant every one of them covered the whole window — and on a
 * wide viewport, covered the rail. Insetting them there was not possible from outside: a pushed
 * root screen brings its own stack of transparent containers that swallow clicks over whatever they
 * are inset past, so the rail showed through but could not be pressed. Pushing within the tab
 * navigator sidesteps the question entirely: the slot is already inset by the rail, so a screen in
 * here is too, and the rail is a sibling rather than something underneath.
 *
 * The URLs survive the move (`/settings/general` rather than `/settings-general`), so deep links and
 * the browser's own Back still work — which the alternative (rendering these as in-screen layers)
 * would have cost.
 *
 * On native this is the visible change: the bottom bar stays put while you are in a settings
 * sub-screen, because these no longer cover the tab navigator.
 */
export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
