import { useEffect, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';

import { logDeferReady } from '@/lib/nav-timing'; // TEMP nav timing

/**
 * Returns `false` on the first commit, then `true` once the current
 * interaction/transition has settled — a gate for deferring a screen's
 * expensive subtree (a big list, secondary queries) off the critical path.
 *
 * Why it exists: on iOS a native stack push, and the custom tab-slot swap
 * (`app-tabs.tsx`, no native animation), can't *visibly* start until the JS
 * thread commits the incoming screen's first render. If that first render mounts
 * a `LegendList` + several `useQuery`s synchronously, the transition is stuck
 * behind it for the whole mount — reading as up to ~1s of dead time before the
 * screen even appears. Painting a cheap first frame (top bar + skeleton) and
 * mounting the heavy part `runAfterInteractions` lets the swap/push play
 * immediately, then fills in a beat later.
 *
 * Web has no native commit gate to protect (the "transition" is a DOM swap on a
 * far faster engine), so it resolves synchronously — no needless skeleton flash.
 */
export function useDeferredMount(label?: string): boolean {
  const [ready, setReady] = useState(Platform.OS === 'web');

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const t0 = Date.now(); // TEMP nav timing
    const handle = InteractionManager.runAfterInteractions(() => {
      if (label) logDeferReady(label, Date.now() - t0); // TEMP nav timing
      setReady(true);
    });
    return () => handle.cancel();
  }, [label]);

  return ready;
}
