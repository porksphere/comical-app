/**
 * A hold-to-arm gesture: press and KEEP holding, and three haptic beats ramp up in intensity
 * (soft → light → medium) as a countdown; keep holding through all three and the hold ARMS —
 * `onArm` fires once, on the ramp's ONE strong closing beat. The felt shape is
 * "bip. bip.. bip… BIP": three escalating small beats, then a single heavy thump as the commit.
 * Releasing (or the press being cancelled) at any point before that aborts silently. Deliberate
 * friction for a consequential toggle a plain tap shouldn't flip (e.g. the Browse bridge icon's
 * session NSFW override).
 *
 * Returns `onPressIn`/`onPressOut` to spread onto a `Pressable`. Timer-driven off the press
 * events, so it works anywhere a Pressable does — including web, where RNGH long-press gestures
 * don't. (Don't use it on rows inside native scroll views: press-in there is unreliable, same
 * reason `Holdable` exists.)
 */
import { useEffect, useRef } from 'react';

import { hapticImpactHeavy, hapticImpactLight, hapticImpactMedium, hapticImpactSoft } from '@/lib/haptics';

/** The countdown beats (ms into the hold), each a step up in intensity. */
const RAMP_MS = [250, 500, 750] as const;
/** When the hold arms — the ramp's closing heavy beat, distinct from the countdown ticks. */
const ARM_MS = 950;

export function useRampedHold(onArm: () => void): {
  onPressIn: () => void;
  onPressOut: () => void;
} {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Read at fire time so the armed callback is always the latest render's, without the handlers
  // themselves changing identity per render.
  const armRef = useRef(onArm);
  useEffect(() => {
    armRef.current = onArm;
  });

  const clear = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  // Unmount mid-hold must not leave timers armed.
  useEffect(() => clear, []);

  return {
    onPressIn: () => {
      clear();
      const beats = [hapticImpactSoft, hapticImpactLight, hapticImpactMedium];
      timers.current = beats.map((beat, i) => setTimeout(beat, RAMP_MS[i]));
      timers.current.push(
        setTimeout(() => {
          clear();
          // The BIP: one clean heavy impact, not a multi-pulse notification (which read as a
          // weird stuttered buzz at the top of the ramp).
          hapticImpactHeavy();
          armRef.current();
        }, ARM_MS),
      );
    },
    onPressOut: clear,
  };
}
