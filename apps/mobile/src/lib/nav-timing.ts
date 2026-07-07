import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

/**
 * TEMPORARY press → first-commit timing for the iOS navigation / tab-switch
 * stall. Call `markNavStart` on a card or tab press; the destination screen
 * calls `useNavArrival` so it logs when it first gains focus. Prints to the JS
 * console (Metro, or the Xcode/device console for a sideloaded build) tagged
 * `[NAV-TIMING]`.
 *
 * The measured span is touch-down → destination screen focus, so it includes the
 * brief finger-hold before release — fine for comparing before/after, since that
 * hold is tiny next to the ~1s stall we're chasing. Native is where the stall
 * lives; the log runs on every platform for parity (web numbers should be tiny).
 *
 * Safe to delete wholesale once the iOS transition latency is confirmed fixed —
 * remove this file and its four call sites (series-card, series, app-tabs, and
 * the tab screens' `useNavArrival`).
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
