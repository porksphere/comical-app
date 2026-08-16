import { logDiagnostic } from '@/lib/diagnostics';
import { PROFILING_ENABLED } from '@/lib/profiling';

/**
 * The watchdog for "the app got PUSHED BACK and stayed there" — the whole screen scaled down a
 * notch and dimmed, as if a sheet were open, with nothing on top of it.
 *
 * Exactly two things in this app push the whole app back, and both are one-way latched by design:
 *
 *  1. `OverlayProvider`'s `appProgress` (scale 0.93, dim 0.5, 28px corners — the tray/bridge-selector
 *     animation). It is driven off `items.length`, and an item only ever LEAVES that array from an
 *     exit animation's completion callback. Reanimated reports `finished: false` for any curve that
 *     got interrupted, so a callback gated on it is not a promise that it will ever run — and an
 *     item that never leaves keeps the app scaled and dimmed for the rest of the process.
 *  2. `seriesReaderDim` (scale 0.9375, dim 0.14 — the series page's backdrop treatment). A module
 *     level shared value written every frame by a UI-thread reaction and reset from ONE place: the
 *     depth-0 series instance's unmount. Anything that lands a write after that reset strands it.
 *
 * Both live above every screen and outlive navigation, so a strand is invisible to any per-screen
 * recovery and survives until the process restarts. That is the reported bug, and the reason it
 * "gets stuck until a restart".
 *
 * So: the owners of each signal say when they take it and when they let it go, and when the last
 * owner lets go this module checks that the signal actually came back to rest. If it didn't, the
 * state that led there is written to the PERSISTED diagnostics log (Settings → Diagnostics,
 * shareable, survives a restart — which is the whole point: the bug is noticed long after the frame
 * that caused it) and the signal is eased back to rest, so the app recovers on its own instead of
 * needing that restart.
 *
 * ── What ships ──────────────────────────────────────────────────────────────────────────────────
 * This module is DIAGNOSTICS, and every entry point is gated on `PROFILING_ENABLED` — a dev build,
 * or the profiling-release build CI can produce. In a public build all three fold to an early
 * return: no trail, no timers, no log entries, and no auto-recovery.
 *
 * That is a real trade and it is deliberate. What actually FIXES the reported bug ships in every
 * build and is not in this file — the overlay's closing latch, its removal of an item regardless of
 * whether the exit curve reported `finished`, its wall-clock backstop, and the series page putting
 * the backdrop back on unmount. The watchdog only ever catches what those miss, so a public build
 * relies on them and a dev build additionally gets told when they didn't. Callers don't branch: the
 * backstop still removes the stranded item in production, it just doesn't write the entry.
 *
 * Cost at rest, when enabled, is one `setTimeout` per close and one value read when it fires.
 * Nothing here runs per frame, and nothing here runs at all while an overlay is legitimately open.
 *
 * Plain JS on purpose — no Reanimated and no `react-native` import, neither of which a bun unit test
 * can load — so the decision logic here is actually covered by one (`pushback-watchdog.test.ts`).
 * Same split, for the same reason, as `tab-bar-visibility` next to `tab-bar-slide`. The Reanimated
 * half is `lib/pushback-signal.ts`.
 */

/** How the watchdog gets at one pushback signal, without knowing what it is made of.
 *
 *  `read` is a CALLBACK rather than a return value because the real signal is a shared value whose
 *  home is the UI thread: the JS-side copy of something a UI-thread reaction writes every frame can
 *  be arbitrarily stale, so the only trustworthy answer comes back asynchronously. */
export type PushbackSignal = {
  read: (then: (value: number) => void) => void;
  /** Ease the signal back to rest. */
  rest: () => void;
};

/** How long after the last owner lets go a signal is still allowed to be moving. The exits it
 *  covers are a 240ms timing and a ~400ms spring, so this is generous on purpose — a false report
 *  would be worse than a slightly late recovery. */
export const SETTLE_MS = 1500;
/** Below this the signal is at rest for all practical purposes (a spring can settle at 1e-4). */
const AT_REST = 0.01;
/** Enough to hold the run-up to a strand — an open, its close, and whatever raced them. */
const TRAIL_LENGTH = 24;

const trail: string[] = [];
const bootedAt = Date.now();

/**
 * Records one step in the life of a pushback signal, in memory only. This is the run-up, not the
 * report: it costs a string per overlay open/close (not per frame) and is only ever read when a
 * strand is actually found, at which point it goes into the persisted entry as context.
 */
export function notePushback(event: string, detail?: string): void {
  if (!PROFILING_ENABLED) return;
  trail.push(`+${((Date.now() - bootedAt) / 1000).toFixed(1)}s ${event}${detail ? ` ${detail}` : ''}`);
  if (trail.length > TRAIL_LENGTH) trail.splice(0, trail.length - TRAIL_LENGTH);
}

/**
 * Writes a strand to the persisted log. Public because the owners can detect their own strands more
 * precisely than this module can from the outside — the overlay's wall-clock backstop knows its
 * exit curve never reported back, which is a fact no amount of value-watching could recover.
 */
export function reportStuck(source: string, message: string, detail?: string): void {
  if (!PROFILING_ENABLED) return;
  notePushback(`${source} STUCK`, message);
  const context = [detail, 'trail:', ...trail.map((t) => `  ${t}`)].filter(Boolean).join('\n');
  logDiagnostic('stuck-pushback', `${source}: ${message}`, { context });
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** The signal has an owner again — whatever we were about to check no longer applies. */
export function cancelSettleCheck(source: string): void {
  const t = pending.get(source);
  if (t === undefined) return;
  clearTimeout(t);
  pending.delete(source);
}

/**
 * The last owner just let go: verify the signal really came back to rest, and if it didn't, log it
 * and ease it back.
 *
 * Both callbacks are thunks because what matters is the state AT THE REPORT, not when the check was
 * armed. `stillIdle` re-asks whether nobody owns the signal — a new overlay opening in the sub-frame
 * gap between the open and the re-render that would have cancelled this check must not be reported
 * as a strand, still less have its entrance animation shoved back to zero. `detail` answers the
 * first question anyone asks of one of these entries: was the app pushed back by an overlay that
 * never left, or by a progress value that never came home with nothing open at all.
 */
export function armSettleCheck(
  source: string,
  signal: PushbackSignal,
  detail?: () => string,
  stillIdle?: () => boolean,
): void {
  if (!PROFILING_ENABLED) return;
  cancelSettleCheck(source);
  pending.set(
    source,
    setTimeout(() => {
      pending.delete(source);
      if (stillIdle && !stillIdle()) return;
      signal.read((value) => {
        if (Math.abs(value) <= AT_REST) return;
        // Re-asked after the read as well as before it: the read is a round trip to the UI thread,
        // and an overlay opening while it was in flight would make this a report about a value that
        // is now legitimately on its way up.
        if (stillIdle && !stillIdle()) return;
        reportStuck(
          source,
          `still pushed back (${value.toFixed(3)}) ${SETTLE_MS}ms after the last owner let go — recovered`,
          detail?.(),
        );
        signal.rest();
      });
    }, SETTLE_MS),
  );
}
