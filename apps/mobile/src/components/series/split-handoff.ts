

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
