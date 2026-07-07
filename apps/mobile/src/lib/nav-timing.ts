import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

import { logDiagnostic } from '@/lib/diagnostics';

/**
 * TEMPORARY timing/diagnostics for the iOS navigation / tab-switch stall. Every
 * signal is written to the on-device diagnostics log (Settings → Diagnostics →
 * Failure log), so it's readable on a device with no Mac / Metro attached —
 * newest first — and mirrored to the JS console for when Metro *is* attached.
 *
 * Three signals, which together localize where the perceived delay lives:
 *
 *  - `nav-timing`  press → destination screen's FIRST commit (the transition /
 *    cheap skeleton frame). `markNavStart` on the press, `useNavArrival` on the
 *    destination. Span is touch-down → focus, so it includes the brief
 *    finger-hold — fine next to a ~1s stall.
 *  - `defer-timing`  first commit → the deferred heavy content actually mounting
 *    (see `useDeferredMount`). This is the `InteractionManager.runAfterInteractions`
 *    delay — if the JS thread is busy (e.g. parsing embedded-runtime results),
 *    the callback is starved and this number balloons. The tab number *feels*
 *    longer than `nav-timing` because THIS is the part you actually wait through.
 *  - `js-jank`  the main JS thread was blocked ≥ JANK_THRESHOLD_MS during a tick
 *    (a periodic timer that came back late). Direct evidence of something hogging
 *    the JS thread; timestamps let you line it up against a navigation.
 *
 * Safe to delete wholesale once the iOS latency is understood — remove this file,
 * `startNavDiagnostics()` in `_layout.tsx`, `markNavStart`/`useNavArrival`/the
 * `useDeferredMount` labels at their call sites.
 */

let pending: { label: string; t: number } | null = null;

export function markNavStart(label: string): void {
  pending = { label, t: Date.now() };
}

export function logNavArrival(label: string): void {
  const start = pending;
  if (!start) return;
  pending = null;
  const ms = Date.now() - start.t;
  logDiagnostic('nav-timing', `${start.label} -> ${label}: ${ms}ms`, { context: Platform.OS });
  // eslint-disable-next-line no-console
  console.log(`[NAV-TIMING] ${start.label} -> ${label}: ${ms}ms (${Platform.OS})`);
}

/** Logs arrival on focus against the most recent `markNavStart`, if any. */
export function useNavArrival(label: string): void {
  useFocusEffect(
    useCallback(() => {
      logNavArrival(label);
    }, [label]),
  );
}

/** How long the deferred (post-transition) content took to mount after the
 *  screen's first commit — i.e. how long `runAfterInteractions` was delayed. */
export function logDeferReady(label: string, ms: number): void {
  logDiagnostic('defer-timing', `${label}: heavy content mounted +${ms}ms after first frame`, { context: Platform.OS });
  // eslint-disable-next-line no-console
  console.log(`[NAV-TIMING] defer ${label}: +${ms}ms (${Platform.OS})`);
}

// ── JS-thread jank monitor ────────────────────────────────────────────────────
// A periodic timer expects to fire every JANK_TICK_MS; if it comes back later
// than that by ≥ JANK_THRESHOLD_MS, the main JS thread was blocked in between
// (rendering, or parsing/adapting embedded-runtime results). Only logs when it
// actually janks, so it's low volume, and the timestamp lets you correlate a
// spike with a navigation you just did.
const JANK_TICK_MS = 250;
const JANK_THRESHOLD_MS = 120;
let jankStarted = false;

export function startNavDiagnostics(): void {
  if (jankStarted || Platform.OS === 'web') return;
  jankStarted = true;
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const blocked = now - last - JANK_TICK_MS;
    last = now;
    if (blocked >= JANK_THRESHOLD_MS) {
      logDiagnostic('js-jank', `main JS thread blocked ~${blocked}ms`, { context: Platform.OS });
      // eslint-disable-next-line no-console
      console.log(`[NAV-TIMING] js-jank ~${blocked}ms (${Platform.OS})`);
    }
  }, JANK_TICK_MS);
}
