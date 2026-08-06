import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

/**
 * The SOURCE RECT of the card a series was opened from, so
 * the series page can grow out of it (and shrink back into it) the way a photo grid opens a photo.
 *
 * A one-slot module-level hand-off, not context or a store, for the same reason
 * `lib/series page-backdrop.ts` is: the writer (a card in a recycled grid) and the reader (a
 * modal route that is not its descendant) share no provider, and the value has to be readable
 * SYNCHRONOUSLY in the destination's first render — a state update would land a frame late, i.e.
 * after the entrance has already started from the wrong geometry.
 *
 * Rect capture happens on press-IN (a native `measureInWindow` round trip is async, and doing it
 * on press would delay navigation by a frame), so a hold that never becomes a tap — a long-press
 * context menu, a drag that turns into a scroll — also writes one. Two guards keep a stale rect
 * from being applied to an unrelated open: the entry id must match the destination's, and the
 * capture must be recent.
 *
 */

/** A card's on-screen box, in WINDOW coordinates (what `measureInWindow` reports). */
export type ZoomOrigin = { x: number; y: number; width: number; height: number };

type Capture = { id: string; origin: ZoomOrigin; at: number };

/** Beyond this, a captured rect is assumed to belong to some earlier, abandoned press. */
const MAX_AGE_MS = 1500;

let pending: Capture | null = null;
/** The last capture actually handed out. Kept so a double-invoked `useState` initializer (React
 *  StrictMode renders twice in dev) sees the same origin both times instead of losing it. */
let taken: Capture | null = null;

/** Called from a series card's press-in. Overwrites any earlier capture — the newest press wins. */
export function setZoomOrigin(id: string, origin: ZoomOrigin): void {
  pending = { id, origin, at: Date.now() };
}

/** Consumes the pending capture, but only if it was made for THIS series and recently enough.
 *  Returns null otherwise — the caller then falls back to its non-zoom entrance. */
export function takeZoomOrigin(id: string | undefined): ZoomOrigin | null {
  if (!id) return null;
  const now = Date.now();
  if (taken && taken.id === id && now - taken.at <= MAX_AGE_MS) return taken.origin;
  const capture = pending;
  pending = null;
  if (!capture || capture.id !== id || now - capture.at > MAX_AGE_MS) return null;
  taken = capture;
  return capture.origin;
}

/**
 * Which series are currently mid-zoom, by id (a count, because a drilled layer can be flying while
 * its parent still is). While a series is in here its card BLANKS ITS COVER — the transition flies
 * a copy of that cover, and leaving the original showing means two of them: visibly so on the way
 * back, where the page is half-transparent for most of the collapse and the grid shows straight
 * through it while the copy is still in the air.
 *
 * Exactly the treatment the long-press menu already gets (`SeriesCardMenu`'s `hidden` → the card's
 * `coverHidden`), for exactly the same reason, and what the library does with `shouldHideSource`.
 *
 * In-memory Legend State per the repo's split — a card reads it through a SELECTOR, so a grid of
 * them subscribes but only the one card whose boolean actually flips re-renders.
 */
const zoomingSeries$ = observable<Record<string, number>>({});

/** Marks `id` as flying; returns the matching release. Safe to call for an id already flying. */
export function holdZoomingSeries(id: string): () => void {
  zoomingSeries$[id].set((n) => (n ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (zoomingSeries$[id].peek() ?? 1) - 1;
    if (next > 0) zoomingSeries$[id].set(next);
    else zoomingSeries$[id].delete();
  };
}

/** Whether this series' card should blank its cover right now. */
export function useIsZoomingSeries(id: string): boolean {
  return use$(() => !!zoomingSeries$[id].get());
}
