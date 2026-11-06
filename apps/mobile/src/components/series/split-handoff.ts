/**
 * The details and the reader are two pages rather than two sides of one. `details` is
 * `series/index`, whose strip still shows the page you are on and opens `series/read` to read;
 * `reader` is that page, whose Details button goes back to the details that opened it, or brings
 * them up in its place. A collection's sequence is a reader page, whose Details open the visible
 * entry's own details over it.
 *
 * On iOS they are two cards of a native stack, the tab's or the root route's nested one: UIKit
 * pushes the reader, and the zoom grows it out of the strip (see ZoomSource). Off iOS `read` is a
 * transparent modal over the details, and the page draws the move itself: the reader opens as the
 * strip's own reader growing to the full window, and shrinks back into it on the way out (see
 * SplitHandoff).
 */
export type SeriesSplit = 'details' | 'reader';

// The reader surface's tone. Pure black, like every other page — it mirrored the reference's
// `#reader-view { background: #0f0f0f }` until the app's own background stopped doing the same
// (see `Colors.dark.background`), and a reader a shade lighter than the app it opens out of read
// as a mismatch rather than as its own surface.
export const READER_BACKDROP = '#000000';

// The visible height of the collapsed reader strip (below the safe area) — a faded-out
// background-image band forming the TOP OF THE DETAILS PAGE (it scrolls away under the content
// like any page header, it is not fixed chrome). The reader page grows out of it and shrinks back
// into it.
export const HEADER_BAND = 200;

// The strip-to-details seam gradient's height. It's tall on purpose: the transition is CENTERED
// ON THE SERIES TITLE — the title (the page's first element) renders mid-gradient over the fading
// strip, X-hero style, so the content top inset is derived from this (see headerTopInset), and so
// is the strip's zoom rect (see `stripZoomH`).
export const SHEET_FADE_H = 120;

// Half the title's ~40pt first line — positions the title's CENTER at the gradient's center.
export const TITLE_MID = 20;

// The details-content fade, and the reader's matching tint on its way into the strip, complete
// within this fraction of the travel — weighted toward the START of a reveal and, symmetrically,
// the END of a hide.
export const FADE_WINDOW = 0.4;

/**
 * Off iOS the move between the two pages of the split is drawn by the page that arrives, from
 * where the page it covers left off. Details hand their strip to the reader page they push: where
 * the strip's bottom edge sits, and how far a drag had already opened the reader. A reader that
 * brings its details up in its place asks them to slide up over it. The page that mounts next
 * takes it once, in a state initializer, like a card's zoom origin (lib/series-zoom).
 */
type SplitHandoff =
  | {
      kind: 'strip';
      /** The strip's bottom edge in the window, where the reader page's clip starts. */
      stripBottom: number;
      /** The details' `progress` at the hand-off, where the reader page continues from. */
      progress: number;
      /** Puts the details beneath back at rest, once the reader page covers them. */
      covered: () => void;
    }
  | { kind: 'reveal' };

const SPLIT_HANDOFF_MAX_AGE_MS = 1500;

type PendingSplit = { key: string; handoff: SplitHandoff; at: number };

let pendingSplit: PendingSplit | null = null;

// Kept after the take for StrictMode's second initializer run, as series-zoom keeps `taken`.
let takenSplit: PendingSplit | null = null;

export function handOffSplit(key: string, handoff: SplitHandoff) {
  const entry = { key, handoff, at: Date.now() };
  pendingSplit = entry;
  // A reader page that never mounted to take the strip must not strand the details mid-drag.
  if (handoff.kind === 'strip') {
    setTimeout(() => {
      if (pendingSplit !== entry) return;
      pendingSplit = null;
      handoff.covered();
    }, SPLIT_HANDOFF_MAX_AGE_MS);
  }
}

export function takeSplitHandoff(key: string, kind: SplitHandoff['kind']): SplitHandoff | null {
  const now = Date.now();
  const fits = (e: PendingSplit | null) =>
    e && e.key === key && e.handoff.kind === kind && now - e.at <= SPLIT_HANDOFF_MAX_AGE_MS ? e : null;
  const fresh = fits(pendingSplit);
  if (!fresh) return fits(takenSplit)?.handoff ?? null;
  pendingSplit = null;
  takenSplit = fresh;
  return fresh.handoff;
}
