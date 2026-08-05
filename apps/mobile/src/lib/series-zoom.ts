/**
 * EXPERIMENTAL series-reader companion: the SOURCE RECT of the card a series was opened from, so
 * `/series-reader` can grow out of it (and shrink back into it) the way a photo grid opens a photo.
 *
 * A one-slot module-level hand-off, not context or a store, for the same reason
 * `lib/series-reader-backdrop.ts` is: the writer (a card in a recycled grid) and the reader (a
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
 * Remove with the experiment: this file, its writer in `components/series-card.tsx`, and the
 * `zoomOrigin` branch in `app/series-reader/index.tsx`.
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
