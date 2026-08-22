import { useIsRestoring } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { useSplashContentReady } from '@/lib/splash-ready';

/** Native cross-dissolve out of the splash. iOS runs it as a
 *  `UIView.transition(.transitionCrossDissolve)` and Android through
 *  `setOnExitAnimationListener` → `.animate().alpha(0)`, so the fade is driven by
 *  the platform and stays smooth even while JS is busy with the first render. */
const FADE_MS = 400;

/** Longest the splash will wait on content before giving up and showing whatever is
 *  there. Covers a launch that doesn't land on Browse (a deep link), an offline
 *  start, and any query state that never settles — the splash must always end. */
const MAX_WAIT_MS = 2500;

// Hold the OS splash past the first rendered frame. Called at module load (this
// file is imported from `_layout.tsx`), which runs well before the first render
// commits — `preventAutoHideAsync` inside an effect would already have lost the
// race against the automatic hide.
SplashScreen.preventAutoHideAsync().catch(() => {});
// Must be set before `hideAsync`. iOS defaults to `fade: false` (an instant cut),
// so the fade has to be asked for; Android already defaults it on.
SplashScreen.setOptions({ fade: true, duration: FADE_MS });

const hide = () => {
  SplashScreen.hideAsync().catch(() => {});
};

/**
 * Keeps the NATIVE splash up until the app has something real to show, then fades
 * it out. Renders nothing: the splash is entirely the OS's, generated from
 * `app.json` by `expo-splash-screen`'s config plugin (an iOS storyboard and
 * Android 12's `windowSplashScreen` theme — see assets/ICONS.md).
 *
 * Ready = the persisted TanStack Query cache has finished restoring from
 * AsyncStorage (`useIsRestoring()`) AND the landing screen has content
 * (`useSplashContentReady()`, set by Browse off the same `homeReady` its bridge
 * crossfade uses). The restore alone is not enough — it completes long before the
 * cross-bridge rails do, which is what made the home appear to pop in after the
 * splash rather than behind it.
 *
 * The wait is capped: `MAX_WAIT_MS` is measured from the moment the restore
 * finishes, so a launch that never reaches Browse still ends. `hideAsync` is a
 * no-op once the splash is gone, so racing the cap against the ready signal is
 * harmless.
 *
 * Native only — the `.web.tsx` sibling is a no-op, since web has no OS splash.
 */
export function SplashGate() {
  const isRestoring = useIsRestoring();
  const contentReady = useSplashContentReady();

  useEffect(() => {
    if (isRestoring) return;
    if (contentReady) {
      hide();
      return;
    }
    const timer = setTimeout(hide, MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [isRestoring, contentReady]);

  return null;
}
