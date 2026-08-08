import { useEffect } from 'react';
import { makeMutable, useFrameCallback } from 'react-native-reanimated';

import { setGestureTraceOnClear, trace, useGestureTraceEnabled } from '@/lib/gesture-trace';

/**
 * A UI-THREAD frame recorder, interleaved into the gesture trace.
 *
 * The CPU profiler cannot answer the question this exists for. It samples the JS thread at ~10ms,
 * and every animation here runs on the UI thread — which on iOS is the main thread, the same one
 * React's native view mounting and layout run on. So a stutter has three quite different possible
 * homes: the JS thread being busy (visible to the profiler), the main thread being busy with view
 * work (invisible to it), or the animation itself being wrong (invisible to both). Guessing between
 * those has cost this branch several builds.
 *
 * `useFrameCallback` runs ON the UI thread, so it measures exactly the thing that matters: if that
 * thread stalls, the callback doesn't run, and the next frame's delta is the size of the stall. Any
 * frame over LONG_FRAME_MS gets a line in the same log, on the same clock, as the gesture events —
 * so a recording shows not just THAT frames were dropped but where in the gesture they went, and
 * whether JS was busy at the time.
 *
 * Free when the trace is off: the callback is deactivated, so Reanimated never schedules it.
 */

/**
 * What counts as a dropped frame.
 *
 * 20 was too tight and it cried wolf for several recordings. Device traces come back sharply
 * bimodal — long stretches at 20.0-20.5, and separate stretches at 34.7-35.2 — which reads as one
 * frame and two frames against a ~17ms budget. At 20 the tool flagged three milliseconds of
 * ordinary jitter as a dropped frame and buried the runs that actually matter, which is how a whole
 * drag came to look like solid jank when the genuinely bad thing was a stretch of 30fps somewhere
 * else entirely.
 *
 * 28 sits between the two clusters: past one frame's jitter at 60Hz, under two. `meanMs` in the
 * summary is what says whether that reasoning still holds on a given device — if the mean is near
 * 8, it's running at 120 and this wants lowering.
 */
const LONG_FRAME_MS = 28;
/** How deep into a run of consecutive long frames to log a second line. Far enough that a brief
 *  hitch stays one line, close enough that a sustained stall is obvious. */
const LONG_RUN_REPORT_AT = 8;

const frames = makeMutable(0);
const longFrames = makeMutable(0);
const worstMs = makeMutable(0);
/** Summed so the summary can report a MEAN, which is what identifies the frame budget in play. */
const totalMs = makeMutable(0);
/** Consecutive long frames, so a run reports once instead of once per frame — see the callback. */
const runLength = makeMutable(0);

/** Reset with the trace, so a recording's summary describes that recording. */
function resetFrameTrace(): void {
  frames.set(0);
  longFrames.set(0);
  worstMs.set(0);
  totalMs.set(0);
  runLength.set(0);
}

setGestureTraceOnClear(resetFrameTrace);

export type FrameSummary = { frames: number; long: number; worstMs: number; meanMs: number };

export function readFrameSummary(): FrameSummary {
  const n = frames.value;
  return {
    frames: n,
    long: longFrames.value,
    worstMs: worstMs.value,
    meanMs: n > 0 ? totalMs.value / n : 0,
  };
}

/**
 * Mount ONCE, at the app root. Recording is global — a stutter is a property of the frame loop, not
 * of whichever screen happens to be asking about it.
 */
export function useFrameTrace(): void {
  const recording = useGestureTraceEnabled();
  // `false` = don't autostart; the effect below owns whether this runs at all.
  const callback = useFrameCallback((info) => {
    'worklet';
    // Reanimated's OWN delta. The first cut of this subtracted successive `info.timestamp`s, which
    // produced numbers that couldn't be right — every logged frame claimed 20.4ms while the lines
    // themselves landed 17ms apart, and consecutive frames cannot be both. `timeSincePreviousFrame`
    // is the measurement rather than a reconstruction of it, and it is null on the first frame.
    const dt = info.timeSincePreviousFrame;
    if (dt === null) return;
    frames.set(frames.value + 1);
    totalMs.set(totalMs.value + dt);
    if (dt > worstMs.value) worstMs.set(dt);
    if (dt < LONG_FRAME_MS) {
      runLength.set(0);
      return;
    }
    longFrames.set(longFrames.value + 1);
    // A RUN of long frames logs its first and then goes quiet, reporting the whole run when it ends.
    // Without this, a stretch where every frame is late — which is exactly the interesting case —
    // emits a runOnJS per frame, so the recorder becomes a meaningful share of the load it is
    // measuring. The counters above still see every frame.
    const run = runLength.value + 1;
    runLength.set(run);
    if (run === 1) trace('frame', 'LONG', { dt });
    else if (run === LONG_RUN_REPORT_AT) trace('frame', 'LONG.run', { dt, n: run });
  }, false);

  useEffect(() => {
    if (recording) resetFrameTrace();
    callback.setActive(recording);
    return () => callback.setActive(false);
  }, [recording, callback]);
}
