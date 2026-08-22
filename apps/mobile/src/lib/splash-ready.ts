/**
 * "The landing screen has something real to show" — the signal that releases the
 * launch splash.
 *
 * Set by the Browse screen the first time its home has rows (or has settled with
 * none); read by `components/splash-gate.tsx`, which holds the native splash
 * until then. Without it the splash is released on the persisted-cache restore
 * alone, which finishes well before the rails resolve — so the splash cuts away
 * to an empty screen and the whole home pops in a beat later.
 *
 * In-memory only (`observable`, not `persisted$`): it describes this launch, and
 * a persisted `true` would release the next launch's splash instantly. Legend
 * State per AGENTS.md → State — local UI state, not a copy of anything on the
 * server. A set to the current value is a no-op there, so the writer needs no
 * "already set" guard and this can be called on every render pass it's true.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

const contentReady$ = observable(false);

/** Stable module-level setter — the Browse screen calls this once its home is ready to show. */
export function markSplashContentReady(): void {
  contentReady$.set(true);
}

export function useSplashContentReady(): boolean {
  return use$(contentReady$);
}
