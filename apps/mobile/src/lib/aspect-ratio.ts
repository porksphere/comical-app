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

