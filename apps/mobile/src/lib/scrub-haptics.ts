import { useCallback } from 'react';
import { useRealtimeComposer } from 'react-native-pulsar';
import { useSharedValue } from 'react-native-reanimated';

/**
 * The reader scrubber's detent feel, modelled on the Apple Watch Digital Crown.
 *
 * ── Why not `selectionAsync` ────────────────────────────────────────────────────────────────────
 * The crown clicks once per detent as content passes under it, and the click CHANGES with rotation
 * speed rather than simply repeating. `UISelectionFeedbackGenerator.selectionChanged()` — what
 * expo-haptics' `selectionAsync` calls, and what this scrubber used — is a single fixed preset with
 * no intensity or sharpness to vary, so every page felt identical however fast the drag went. It is
 * also a JS call, and the scrubber's whole design is to stay off that thread: the tick was hopping
 * `runOnJS` on the very thread that owes the list its cells, so the ticks jittered exactly when the
 * scrub was fastest and the JS thread busiest.
 *
 * Pulsar's realtime composer is a TurboModule called from inside worklets, so the haptic runs on
 * the UI thread beside the gesture that causes it, and takes amplitude and frequency (Core
 * Haptics' intensity and sharpness) per event.
 *
 * ── Everything is a click ───────────────────────────────────────────────────────────────────────
 * This deliberately does NOT switch to a continuous vibration when the drag gets fast, which was
 * the first thing tried and was wrong on the device: a synthesised envelope is a HUM, and a hum is
 * what a phone does for a notification, not what a detent does under a finger. The crown has no
 * such mode either. Its texture at speed is not a different signal — it is the same clicks, arriving
 * faster than they can be told apart, which the hand reads as a fine ratchet.
 *
 * So every crossing asks for a click and nothing else. What speed changes is:
 *
 *   RATE — capped at the engine's floor. The Taptic Engine cannot render pulses closer than roughly
 *   60ms as separate taps, so crossings inside that window are dropped rather than queued (a queued
 *   tap arrives after the page it belonged to, which reads as lag; a dropped one is invisible). Past
 *   that cap the clicks merge on their own, and the merging IS the texture.
 *
 *   WEIGHT — a slow, deliberate crossing lands firmer and rounder; a fast one is lighter and
 *   crisper. Sixteen full-weight taps a second is the buzz this is avoiding, so the ramp runs the
 *   other way: the faster they come, the less each one asks for.
 */

/** Closer than this, taps aren't felt as separate ones — the low end of the 60–100ms the engine is
 *  reported to resolve, taken deliberately: it is as fine as the ratchet can be made, and beyond it
 *  the merging is what produces the texture. */
const TICK_FLOOR_MS = 60;
/** A crossing this far apart is as deliberate as one gets — the firm end of the ramp. */
const TICK_SLOW_MS = 260;

/** Light and very sharp at speed (a fine ratchet), firmer and slightly rounder when deliberate (a
 *  detent). Both stay near `selectionAsync`'s weight — the crown's click is nearer a tap on glass
 *  than a knock, and this replaces something that was already barely-there on purpose. */
const TICK_FAST_AMPLITUDE = 0.2;
const TICK_SLOW_AMPLITUDE = 0.45;
const TICK_FAST_FREQUENCY = 0.97;
const TICK_SLOW_FREQUENCY = 0.86;

export type ScrubHaptics = {
  /** A drag has begun. Resets the cadence so its first crossing lands as a deliberate one. */
  begin: () => void;
  /** A page boundary was crossed. Call for EVERY crossing — this owns the rate limiting, and it
   *  needs to see the ones it drops in order to know how fast they are coming. */
  crossing: (now: number) => void;
};

function lerp(from: number, to: number, t: number) {
  'worklet';
  return from + (to - from) * Math.min(1, Math.max(0, t));
}

export function useScrubHaptics(): ScrubHaptics {
  const composer = useRealtimeComposer();
  const lastTickAt = useSharedValue(0);

  const begin = useCallback(() => {
    'worklet';
    lastTickAt.set(0);
  }, [lastTickAt]);

  const crossing = useCallback(
    (now: number) => {
      'worklet';
      const gap = now - lastTickAt.value;
      // Deliberately NOT recording the dropped crossing: the gap keeps growing from the last tap
      // that was actually felt, so the next one lands as soon as the engine can carry it rather
      // than a further floor's-worth later.
      if (gap < TICK_FLOOR_MS) return;
      lastTickAt.set(now);

      const deliberate = (gap - TICK_FLOOR_MS) / (TICK_SLOW_MS - TICK_FLOOR_MS);
      composer.playDiscrete(
        lerp(TICK_FAST_AMPLITUDE, TICK_SLOW_AMPLITUDE, deliberate),
        lerp(TICK_FAST_FREQUENCY, TICK_SLOW_FREQUENCY, deliberate),
      );
    },
    [composer, lastTickAt],
  );

  return { begin, crossing };
}
