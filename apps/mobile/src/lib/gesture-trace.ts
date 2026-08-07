import { useSyncExternalStore } from 'react';
import { makeMutable, runOnJS, type SharedValue } from 'react-native-reanimated';

import { persisted$ } from '@/lib/observable';

/**
 * An on-device recorder for what the gesture recognizers actually did — built because the
 * back-swipe kept "not working" with no way to tell WHICH of the several possible failures was
 * happening on the device it was failing on.
 *
 * The thing that makes this hard to reason about from source is that a gesture failing to run
 * looks identical from the outside no matter where it died, and there are at least five distinct
 * places it can die:
 *
 *   1. the recognizer never sees the touches at all (something above it swallowed them),
 *   2. it sees them and reaches BEGAN, but never activates (the offsets never satisfied, or a
 *      failOffset tripped first),
 *   3. it activates and is then CANCELLED by a native scroll view winning the contest,
 *   4. it runs, but a gate inside the callbacks (`detailsActive`, `edgeCommitting`) makes every
 *      callback a no-op,
 *   5. it runs correctly and the ANIMATION after it is what's wrong.
 *
 * Every one of those presents to a person holding the phone as "the swipe doesn't work". This
 * module makes them different from each other: each recognizer reports its own lifecycle, tagged
 * with which copy it is, and the trace is a flat time-ordered list you can share out of Settings →
 * Diagnostics → Gesture trace.
 *
 * ── Cost when off ───────────────────────────────────────────────────────────────────────────────
 * `trace()` is a shared-value read and an early return, so a disabled trace costs nothing per
 * frame. More importantly the TOUCH-LEVEL callbacks are only attached when the flag is on (call
 * sites gate on `isGestureTraceEnabled()` at gesture-build time, and re-build when it flips):
 * attaching `onTouchesDown`/`onTouchesMove` flips RNGH's `needsPointerData`, which is a real change
 * to how the native recognizer is configured. A diagnostic that changes the thing it measures is
 * worse than no diagnostic, so with the flag off the gestures are configured exactly as they are
 * in a build that has never heard of this file.
 */

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
export const gestureTrace$ = persisted$('comical:gesture-trace', { enabled: false });

/** The flag as the worklets see it. Mirrored rather than read through Legend State because `trace`
 *  runs on the UI thread, where an observable read isn't available. */
const enabledSV = makeMutable(false);

function syncEnabled(on: boolean): void {
  enabledSV.set(on);
  enabledJS = on;
}
let enabledJS = false;
syncEnabled(!!gestureTrace$.enabled.peek());
// Fires on hydration from disk as well as on a toggle, so a trace left on across a restart is
// still on.
gestureTrace$.enabled.onChange(({ value }) => syncEnabled(!!value));

export function isGestureTraceEnabled(): boolean {
  return enabledJS;
}

export function useGestureTraceEnabled(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => gestureTrace$.enabled.onChange(onStoreChange),
    () => !!gestureTrace$.enabled.peek(),
    () => !!gestureTrace$.enabled.peek(),
  );
}

/** Long enough to hold several swipes end to end, short enough that sharing it is one paste. */
const CAPACITY = 800;

const lines: string[] = [];
let snapshot: readonly string[] = [];
const listeners = new Set<() => void>();
let notifyQueued = false;

/**
 * Re-renders are COALESCED. A single swipe emits a burst of entries and the screen showing them
 * only ever needs the settled result — without this the recorder would itself become the frame
 * budget problem it's meant to diagnose.
 */
function notifySoon(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  setTimeout(() => {
    notifyQueued = false;
    snapshot = lines.slice();
    for (const listener of listeners) listener();
  }, 150);
}

function push(line: string): void {
  lines.push(line);
  if (lines.length > CAPACITY) lines.splice(0, lines.length - CAPACITY);
  notifySoon();
}

function format(t: number, tag: string, event: string, data?: Record<string, number | boolean>): string {
  'worklet';
  let out = `${t.toFixed(0).padStart(6)}  ${tag} ${event}`;
  if (data) {
    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]!;
      const value = data[key];
      if (value === undefined) continue;
      out += ` ${key}=`;
      if (typeof value === 'boolean') out += value ? 'Y' : 'n';
      else if (Math.abs(value) >= 100) out += value.toFixed(0);
      else out += value.toFixed(1);
    }
  }
  return out;
}

/**
 * The UI-thread clock. `performance.now()` exists on Reanimated's UI runtime and on JS, but this
 * is defensive on purpose: a diagnostic that throws inside a gesture callback would take the
 * gesture down with it, which is precisely the failure it's here to investigate.
 */
function clockMs(): number {
  'worklet';
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

/**
 * The UI thread's zero point, as a SHARED VALUE rather than a module-level `let`. A worklet gets a
 * copy of the module scope it captured, so a plain variable written from the UI thread would read
 * back as its initial value on every call — the trace would stamp every line 0ms and be useless
 * for exactly the question it exists to answer (what happened in what order, how far apart).
 */
const uiEpoch = makeMutable(-1);

/** Record from a worklet (any gesture callback). */
export function trace(tag: string, event: string, data?: Record<string, number | boolean>): void {
  'worklet';
  if (!enabledSV.value) return;
  const now = clockMs();
  if (uiEpoch.value < 0) uiEpoch.set(now);
  runOnJS(push)(format(now - uiEpoch.value, tag, event, data));
}

/**
 * Record from JS — scroll handlers, effects, anything not on the UI thread.
 *
 * Stamped from the SAME clock and the same zero point as the worklet path, deliberately: the whole
 * value of mixing the two is being able to read "the scroller moved between BEGAN and FINALIZE"
 * off one timeline, and two epochs would make that interleaving fiction. `performance.now()` is
 * backed by the same monotonic source on both runtimes; if that ever stops being true it shows up
 * as JS lines landing at impossible times rather than as a subtly wrong ordering.
 */
export function traceJS(tag: string, event: string, data?: Record<string, number | boolean>): void {
  if (!enabledJS) return;
  const now = clockMs();
  if (uiEpoch.value < 0) uiEpoch.set(now);
  push(format(now - uiEpoch.value, tag, event, data));
}

/**
 * A per-gesture gate for the high-rate callbacks (`onTouchesMove`, `onUpdate`). Those fire every
 * frame; recording all of them buries the lifecycle events that actually matter under a wall of
 * near-identical lines. Build one per gesture copy, alongside the copy's other shared values.
 */
export function traceGate(): SharedValue<number> {
  return makeMutable(0);
}

/** Record at most once per `ms`, plus nothing when tracing is off. */
export function traceThrottled(
  gate: SharedValue<number>,
  ms: number,
  tag: string,
  event: string,
  data?: Record<string, number | boolean>,
): void {
  'worklet';
  if (!enabledSV.value) return;
  const now = clockMs();
  if (now - gate.value < ms) return;
  gate.set(now);
  trace(tag, event, data);
}

/** Newest LAST — this reads as a timeline, so it's kept in the order things happened. */
export function getGestureTrace(): readonly string[] {
  return snapshot;
}

export function subscribeGestureTrace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGestureTrace(): readonly string[] {
  return useSyncExternalStore(subscribeGestureTrace, getGestureTrace, getGestureTrace);
}

export function clearGestureTrace(): void {
  lines.length = 0;
  snapshot = [];
  uiEpoch.set(-1);
  for (const listener of listeners) listener();
}

/** A visible divider, so a shared log says where one attempt ended and the next began. */
export function markGestureTrace(label: string): void {
  if (!enabledJS) return;
  push(`\n──── ${label} ────`);
}
