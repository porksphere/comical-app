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
 * ── Why a crossing is not always a click ────────────────────────────────────────────────────────
 * The Taptic Engine cannot render pulses closer than roughly 60–100ms as SEPARATE taps; below that
 * they fuse into a buzz. The old code dealt with that by dropping crossings inside a 45ms window —
 * under the floor either way, so at speed it was asking for taps that physically merged, and what
 * you felt was mush with some pages missing.
 *
 * The crown's answer, and this one, is that speed changes the KIND of feedback rather than the
 * amount:
 *
 *   SLOWLY — each page boundary is its own click, sharp and short, so pages can be counted by
 *   feel. Amplitude leans on how deliberate the crossing was: a slow, considered one lands firmer.
 *
 *   FAST — no attempt to click per page. A continuous low texture instead, its amplitude and
 *   frequency climbing with how quickly pages are going by, so speed is felt as intensity rather
 *   than as a rate nothing can resolve. This is the "rumble", and it is the part `selectionAsync`
 *   could never have produced.
 *
 * The changeover is the engine's own floor, which is why it is where it is rather than tuned by
 * taste. Coming back under it, the texture stops and the clicks resume.
 */

/** Below this gap between crossings, separate clicks stop being separately felt. The mid-point of
 *  the 60–100ms the engine is reported to resolve, and the line between clicking and texturing. */
const TICK_FLOOR_MS = 80;
/** A crossing this far apart is as deliberate as one gets — the top of the amplitude ramp. */
const TICK_SLOW_MS = 260;

/** A single detent. Sharp (high frequency) and light, which is what reads as a click rather than a
 *  thump; the crown's is nearer a tap on glass than a knock. */
const TICK_FREQUENCY = 0.92;
const TICK_MIN_AMPLITUDE = 0.35;
const TICK_MAX_AMPLITUDE = 0.62;

/** The texture, at the changeover and at the fastest a drag realistically goes. Deliberately well
 *  under the click amplitudes: it is a floor the fingertip notices, not a vibration. */
const RUMBLE_MIN_AMPLITUDE = 0.1;
const RUMBLE_MAX_AMPLITUDE = 0.32;
const RUMBLE_MIN_FREQUENCY = 0.45;
const RUMBLE_MAX_FREQUENCY = 0.8;
/** Crossings this much faster than the floor are the top of the texture ramp (~8ms apart). */
const RUMBLE_FASTEST_MS = 10;

/** A drag that has crossed nothing for this long has stopped, whether or not the finger has lifted.
 *  The texture ends with the movement that justified it — a rumble outliving the motion is the
 *  thing that reads as the phone being broken. */
const RUMBLE_IDLE_MS = 110;

export type ScrubHaptics = {
  /** A page boundary was crossed. Call for EVERY crossing — the rate limiting here is a change of
   *  character, not a drop, so a crossing withheld is information lost. */
  crossing: (now: number) => void;
  /** Call once per frame of the drag: it is what lets a finger that has come to rest fall silent
   *  without waiting for the release. */
  settle: (now: number) => void;
  /** The drag is over. */
  stop: () => void;
};

function lerp(from: number, to: number, t: number) {
  'worklet';
  return from + (to - from) * Math.min(1, Math.max(0, t));
}

export function useScrubHaptics(): ScrubHaptics {
  const composer = useRealtimeComposer();
  const lastCrossAt = useSharedValue(0);
  const rumbling = useSharedValue(false);

  const crossing = useCallback(
    (now: number) => {
      'worklet';
      const gap = now - lastCrossAt.value;
      lastCrossAt.set(now);

      if (gap >= TICK_FLOOR_MS) {
        // Slow enough to be felt one page at a time.
        if (rumbling.value) {
          composer.stop();
          rumbling.set(false);
        }
        const deliberate = (gap - TICK_FLOOR_MS) / (TICK_SLOW_MS - TICK_FLOOR_MS);
        composer.playDiscrete(lerp(TICK_MIN_AMPLITUDE, TICK_MAX_AMPLITUDE, deliberate), TICK_FREQUENCY);
        return;
      }

      // Too fast for separate clicks. `set` REPLACES the running texture rather than adding to it,
      // so calling it every crossing is what keeps the level tracking the speed.
      const haste = (TICK_FLOOR_MS - gap) / (TICK_FLOOR_MS - RUMBLE_FASTEST_MS);
      composer.set(
        lerp(RUMBLE_MIN_AMPLITUDE, RUMBLE_MAX_AMPLITUDE, haste),
        lerp(RUMBLE_MIN_FREQUENCY, RUMBLE_MAX_FREQUENCY, haste),
      );
      rumbling.set(true);
    },
    [composer, lastCrossAt, rumbling],
  );

  const settle = useCallback(
    (now: number) => {
      'worklet';
      if (!rumbling.value) return;
      if (now - lastCrossAt.value < RUMBLE_IDLE_MS) return;
      composer.stop();
      rumbling.set(false);
    },
    [composer, lastCrossAt, rumbling],
  );

  const stop = useCallback(() => {
    'worklet';
    if (!rumbling.value) return;
    composer.stop();
    rumbling.set(false);
  }, [composer, rumbling]);

  return { crossing, settle, stop };
}
