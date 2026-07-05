/** Default cover/page-thumb aspect ratio (width / height) — used until an image
 *  reports its real size, and as the center of the clamp range below. Mirrors
 *  the reference's fixed 2:3 card shape. */
export const DEFAULT_THUMB_ASPECT = 2 / 3;

// Some bridges' series covers and page thumbnails aren't exactly 2:3. Cards
// keep their configured width as the horizontal max and let the height flex a
// bounded amount to fit the image's real aspect ratio instead of cropping it
// — clamped so one oddly-shaped asset can't blow a tile out into something
// much taller or flatter than its neighbours.
const MIN_THUMB_ASPECT = DEFAULT_THUMB_ASPECT * 0.8;
const MAX_THUMB_ASPECT = DEFAULT_THUMB_ASPECT * 1.25;

/** Clamps a loaded image's natural aspect ratio (width / height) into the
 *  bounded range around `DEFAULT_THUMB_ASPECT`, falling back to the default
 *  when the ratio is missing or not a usable positive number. */
export function clampThumbAspect(ratio?: number | null): number {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return DEFAULT_THUMB_ASPECT;
  return Math.min(MAX_THUMB_ASPECT, Math.max(MIN_THUMB_ASPECT, ratio));
}
