import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

import { logDiagnostic } from '@/lib/diagnostics';

/**
 * TEMPORARY press → first-commit timing for the iOS navigation / tab-switch
 * stall. Call `markNavStart` on a card or tab press; the destination screen
 * calls `useNavArrival` so it logs when it first gains focus.
 *
 * Each arrival is written to the on-device diagnostics log (Settings → app info
 * → Diagnostics), so it's readable on a device with no Mac / Metro console
 * attached — newest first, so the latest navigation sits on top. Also mirrored
 * to the JS console for when Metro *is* attached.
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
  // Surfaced in the Diagnostics screen so it's inspectable on-device (no Mac
  // needed); one entry per navigation, so it's nowhere near a hot path.
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
