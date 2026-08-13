import { useCallback } from 'react';

import type { ScrubHaptics } from './scrub-haptics';

// The scrubber's detent haptics, on web: nothing.
//
// The native side is Pulsar's realtime composer, a TurboModule — importing it here would throw at
// module load (`TurboModuleRegistry.getEnforcing`), which is why this is a platform split rather
// than a `Platform.OS` branch inside one file. The Vibration API that `lib/haptics` falls back to
// elsewhere is no use for this: it has no amplitude or frequency, and a scrub asks for a tap every
// few dozen milliseconds, which on the browsers that support it at all is a continuous buzz.
//
// Worklet-marked to match the native contract exactly, so the caller can hold one shape and never
// branch. Reanimated is present on web, so these are real worklets, and calling them costs nothing.

export type { ScrubHaptics } from './scrub-haptics';

export function useScrubHaptics(): ScrubHaptics {
  const noop = useCallback(() => {
    'worklet';
  }, []);
  return { begin: noop, crossing: noop };
}
