/**
 * A hold-to-arm gesture: press and KEEP holding, and three haptic beats ramp up in intensity
 * (soft → light → medium) as a countdown; keep holding through all three and the hold ARMS —
 * `onArm` fires once, on the ramp's ONE strong closing beat. The felt shape is
 * "bip. bip.. bip… BIP": three escalating small beats — each arriving after a LONGER pause than
 * the last — then a single heavy thump as the commit, after the longest pause of all.
 * Releasing (or the press being cancelled) at any point before that aborts silently. Deliberate
 * friction for a consequential toggle a plain tap shouldn't flip (e.g. the Browse bridge icon's
 * session NSFW override).
 *
 * Returns `onPressIn`/`onPressOut` to spread onto a `Pressable`, plus `pulseStyle` for an
 * `Animated.View` around the held thing: it swells once per beat, by as much as the beat is felt,
 * so the countdown is seen as well as felt (and seen at all on desktop, where there is no
 * haptic). Timer-driven off the press events, so it works anywhere a Pressable does — including
 * web, where RNGH long-press gestures don't. (Don't use it on rows inside native scroll views:
 * press-in there is unreliable, same reason `Holdable` exists.)
 */
import { useEffect, useRef } from 'react';
import type { ViewStyle } from 'react-native';
import { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { hapticImpactHeavy, hapticImpactLight, hapticImpactMedium, hapticImpactSoft } from '@/lib/haptics';

/** The gaps BETWEEN beats, each longer than the last — the cadence of "bip. bip.. bip… BIP": the
 *  countdown stretches as it builds, so the closing thump lands after the longest pause. */
const BEAT_GAPS_MS = [200, 300, 400, 500] as const;
/** Cumulative fire times (ms into the hold): the three countdown beats, then the arming BIP. */
const BEAT_AT_MS = BEAT_GAPS_MS.map((_, i) => BEAT_GAPS_MS.slice(0, i + 1).reduce((a, b) => a + b, 0));

/** How far each beat swells the icon (scale above 1), growing with the haptic it rides on. */
const BEAT_SCALE = [0.06, 0.1, 0.15, 0.24] as const;
/** The swell is quick and the settle slower, so the pulse reads as a beat rather than a wobble —
 *  and the whole thing is over before the next beat is due (the shortest gap is 200ms). */
const PULSE_UP_MS = 70;
const PULSE_DOWN_MS = 120;

export function useRampedHold(onArm: () => void): {
  onPressIn: () => void;
  onPressOut: () => void;
  pulseStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
} {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Read at fire time so the armed callback is always the latest render's, without the handlers
  // themselves changing identity per render.
  const armRef = useRef(onArm);
  useEffect(() => {
    armRef.current = onArm;
  });

  const scale = useSharedValue(1);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pulse = (amount: number) => {
    scale.set(
      withSequence(
        withTiming(1 + amount, { duration: PULSE_UP_MS, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: PULSE_DOWN_MS, easing: Easing.inOut(Easing.quad) }),
      ),
    );
  };

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
      timers.current = beats.map((beat, i) =>
        setTimeout(() => {
          beat();
          pulse(BEAT_SCALE[i]);
        }, BEAT_AT_MS[i]),
      );
      timers.current.push(
        setTimeout(() => {
          clear();
          // The BIP: one clean heavy impact, not a multi-pulse notification (which read as a
          // weird stuttered buzz at the top of the ramp).
          hapticImpactHeavy();
          pulse(BEAT_SCALE[3]);
          armRef.current();
        }, BEAT_AT_MS[3]),
      );
    },
    onPressOut: clear,
    pulseStyle,
  };
}
