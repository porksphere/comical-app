/** Default cover/page-thumb aspect ratio (width / height) — the skeleton's
 *  fixed shape, and the vertical MAX every thumbnail is capped to. Mirrors
 *  the reference's fixed 2:3 card shape. */
export const DEFAULT_THUMB_ASPECT = 2 / 3;

/** Duration for animating a cover/page-thumb's box from the default shape to its
 *  real (capped) aspect once discovered — see `SeriesCard`/`PageThumb`. Roughly
 *  matches `expo-image`'s own `transition={90}` cross-fade so the box resize and
 *  image fade-in read as one coordinated animation. */
export const ASPECT_TRANSITION_MS = 90;

/** Caps a loaded image's natural aspect ratio (width / height) so it never
 *  renders taller than the default 2:3 skeleton shape — a bridge's thumbnail
 *  can be flatter/wider than 2:3 (rendering shorter) but never gets to grow
 *  past the skeleton's height, so the slot a thumbnail sits in never has to
 *  grow to fit it. Falls back to the default when the ratio is missing or not
 *  a usable positive number.
 *
 *  Cards/tiles feed this the dimensions from the visible `<Image>`'s own
 *  `onLoad` (`event.source.width/height`) and hold the result in state — see
 *  `SeriesCard` / `PageThumb`. (There used to be a `usePrefetchedImage` hook
 *  that decoded every image off-screen up front to know its shape a frame
 *  earlier; it was removed because a second decode + extra re-render per card,
 *  across a full grid + rails, was a measurable main-thread cost on device.) */
export function clampThumbAspect(ratio?: number | null): number {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return DEFAULT_THUMB_ASPECT;
  return Math.max(DEFAULT_THUMB_ASPECT, ratio);
}

/**
 * The aspect of the page grid's row SLOT — every row is this tall, and a tile top-aligns inside it.
 *
 * It used to be a flat 2:3, which quietly assumed every source's page thumbnails are 2:3. They
 * aren't — a source shipping 200x289 tiles (a touch wider) is real — so each tile sized itself to its
 * real shape inside a taller slot and left a strip of page background under it: a grey row beneath
 * every thumbnail, across the whole grid. (The card popup's rail was never affected: it sizes each
 * tile to a fixed HEIGHT, so it has no slot to fall short of.)
 *
 * Sprite tiles carry their pixel rect in the payload, so their true shape is known before anything
 * loads. Take the TALLEST of them (the smallest aspect): the slot then fits every tile exactly on the
 * uniform sheets sources actually ship, and no tile is ever clipped. Aspects are clamped at 2:3
 * first, so the result can only ever be SHORTER than the old constant, never taller.
 *
 * A genuinely mixed-aspect gallery still has one tile clamped to 2:3, so it lands on exactly the old
 * height — the wider tiles there keep their gap, which is unavoidable in a fixed-height grid and is
 * what it did before. Image thumbnails are ignored: their shape isn't known until they load, and
 * forcing a slot before it exists would reflow the row.
 */
export function pageSlotAspect(thumbs: readonly ({ kind: string; w?: number; h?: number } | null)[]): number {
  // The MOST COMMON shape, not the tallest. Taking the tallest looked safer (nothing gets cropped)
  // but is worthless in practice: one odd page in a gallery — and real galleries have one — dragged
  // the slot back to 2:3 and put the gap back under every OTHER tile. The typical tile is the one
  // worth fitting exactly; the odd one out is cropped to fill, which is what the tile does anyway
  // (see PageThumb — the picture covers its box).
  const counts = new Map<number, number>();
  for (const t of thumbs) {
    if (t?.kind !== 'sprite' || !t.w || !t.h) continue;
    const a = clampThumbAspect(t.w / t.h);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [aspect, count] of counts) {
    // Ties go to the TALLER tile (smaller aspect) — it crops less of a wide neighbour than the
    // reverse, and keeps the grid closer to the 2:3 the rest of the app is built around.
    if (count > bestCount || (count === bestCount && best !== null && aspect < best)) {
      best = aspect;
      bestCount = count;
    }
  }
  return best ?? DEFAULT_THUMB_ASPECT;
}
