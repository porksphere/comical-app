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
 * Read `clockMs` first: a threshold means nothing against a delta you cannot trust, and the two
 * earlier versions of this file did not have one. The clusters this number was originally fitted
 * to came from that untrustworthy delta, so they are not evidence of anything.
 *
 * 28 sits between one frame and two at 60Hz: past ordinary jitter on a 16.7ms budget, under a
 * genuine double. `meanMs` in the summary is what says whether that holds on a given device — a
 * mean near 8 means it is running at 120Hz and this wants halving.
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
/** When the previous frame ran, on the clock below. -1 before the first one. */
const lastMs = makeMutable(-1);

/**
 * THE CLOCK — `performance.now()`, deliberately the same source lib/gesture-trace stamps its lines
 * with, rather than either number Reanimated's frame info offers.
 *
 * Both of those have now been tried and both disagreed with the timeline they were printed on, by
 * about 2x. `info.timestamp` deltas claimed 20.4ms frames while the lines landed 17ms apart.
 * `timeSincePreviousFrame` replaced it and claimed 35ms frames while the lines still landed 17ms
 * apart — and under the run suppression below two long frames back to back cannot print twice at
 * all, so a line every 17ms was impossible under any reading of it. A recording of ordinary browse
 * scrolling came out looking like eighteen unbroken seconds of 30fps, and that reading was used to
 * call a stretch after the series page's reveal a stall. It was not one.
 *
 * Measuring the gap between successive callback invocations on the trace's own clock cannot
 * contradict the trace: `dt` and the spacing of the lines become the same subtraction. Reanimated's
 * figure rides along as `rn=` on every line, so if the two part company again that is visible in
 * the log instead of being the thing quietly deciding what gets investigated.
 */
function clockMs(): number {
  'worklet';
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

/** Reset with the trace, so a recording's summary describes that recording. */
function resetFrameTrace(): void {
  frames.set(0);
  longFrames.set(0);
  worstMs.set(0);
  totalMs.set(0);
  runLength.set(0);
  lastMs.set(-1);
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
    // The gap since this callback last ran, on the trace's own clock — see `clockMs` for why it is
    // measured here rather than read off `info`. Nothing to compare against on the first frame.
    const now = clockMs();
    const prev = lastMs.value;
    lastMs.set(now);
    if (prev < 0) return;
    const dt = now - prev;
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
    // `rn` is Reanimated's own figure for the same frame, carried purely so the two can be compared
    // in a shared log — see `clockMs`. -1 means it had none.
    const rn = info.timeSincePreviousFrame ?? -1;
    if (run === 1) trace('frame', 'LONG', { dt, rn });
    else if (run === LONG_RUN_REPORT_AT) trace('frame', 'LONG.run', { dt, rn, n: run });
  }, false);

  useEffect(() => {
    if (recording) resetFrameTrace();
    callback.setActive(recording);
    return () => callback.setActive(false);
  }, [recording, callback]);
}
