import { useIsRestoring } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

// Hold the OS splash past the first rendered frame. Called at module load (this
// file is imported from `_layout.tsx`), which runs well before the first render
// commits — `preventAutoHideAsync` inside an effect would already have lost the
// race against the automatic hide.
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Keeps the NATIVE splash up until the app has something real to show, then
 * lets it go. Renders nothing: the splash is entirely the OS's, generated from
 * `app.json` by `expo-splash-screen`'s config plugin (an iOS storyboard and
 * Android 12's `windowSplashScreen` theme — see assets/ICONS.md).
 *
 * "Ready" = the persisted TanStack Query cache has finished restoring from
 * AsyncStorage (`useIsRestoring()` — the one meaningful async step at startup;
 * the embedded runtime install in `startup.ts` is synchronous and there are no
 * fonts to load). Without the hold, the splash drops on the first frame and the
 * first screen paints empty, then pops its cached Library/History/Activity in a
 * moment later.
 *
 * This is the whole of the app's splash logic — there is no JS-drawn splash. If
 * you want the OS default instead (splash disappears the instant the first frame
 * renders, empty screen and all), delete this component and its `_layout.tsx`
 * mount; nothing else refers to it.
 *
 * Native only — the `.web.tsx` sibling is a no-op, since web has no OS splash.
 */
export function SplashGate() {
  const isRestoring = useIsRestoring();
  useEffect(() => {
    if (!isRestoring) SplashScreen.hideAsync().catch(() => {});
  }, [isRestoring]);
  return null;
}
