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
 * What counts as a dropped frame. 20ms is past a 60Hz frame (16.7) and well past a 120Hz one (8.3),
 * so on a ProMotion device this reports only real hitches rather than every ordinary frame.
 */
const LONG_FRAME_MS = 20;

const frames = makeMutable(0);
const longFrames = makeMutable(0);
const worstMs = makeMutable(0);
const lastAt = makeMutable(0);

/** Reset with the trace, so a recording's summary describes that recording. */
export function resetFrameTrace(): void {
  frames.set(0);
  longFrames.set(0);
  worstMs.set(0);
  lastAt.set(0);
}

setGestureTraceOnClear(resetFrameTrace);

export type FrameSummary = { frames: number; long: number; worstMs: number };

export function readFrameSummary(): FrameSummary {
  return { frames: frames.value, long: longFrames.value, worstMs: worstMs.value };
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
    const now = info.timestamp;
    const previous = lastAt.value;
    lastAt.set(now);
    // First frame of a recording has nothing to measure against.
    if (previous === 0) return;
    const dt = now - previous;
    frames.set(frames.value + 1);
    if (dt > worstMs.value) worstMs.set(dt);
    if (dt < LONG_FRAME_MS) return;
    longFrames.set(longFrames.value + 1);
    trace('frame', 'LONG', { dt });
  }, false);

  useEffect(() => {
    if (recording) resetFrameTrace();
    callback.setActive(recording);
    return () => callback.setActive(false);
  }, [recording, callback]);
}
