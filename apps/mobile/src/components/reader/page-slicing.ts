import type { Size } from '@/components/reader/page-geometry';

/**
 * The tallest bitmap this reader will hand to a view, in SOURCE pixels.
 *
 * Android draws a view's bitmap by uploading it as a GL texture, and a bitmap longer than
 * `GL_MAX_TEXTURE_SIZE` on either axis cannot be uploaded at all: hwui logs "Bitmap too large to be
 * uploaded into a texture" and draws NOTHING. Not an exception, not an `onError` — a blank page. It
 * is the failure behind every "black screen on long strip" report a webtoon reader collects.
 *
 * 4096 rather than the 8192 most phones report, because the limit is the DRIVER's and there is no
 * floor to it: 8192 and 16384 are the common values, 4096 is still shipping, and devices as low as
 * ~3400 have been reported. A cap that is wrong is worth nothing here — the page it fails on is
 * blank, and the reader has no way to find out. The cost of being conservative is one extra
 * background decode on a page that was already the heaviest thing in the chapter, so this is the
 * knob to raise if slicing ever shows up in a profile, and the reason to leave it alone otherwise.
 */
export const MAX_DRAWABLE_PX = 4096;

/**
 * How much taller than it is wide a picture must be before it counts as a STITCHED STRIP rather
 * than a page. Mihon's own number, and the reason it is needed at all: `MAX_DRAWABLE_PX` alone
 * would also catch a legitimately huge single page — a double-page spread scanned at 300dpi — and
 * cutting one of those in half puts a seam across artwork that was drawn to be seen whole. Nothing
 * drawn as one picture is three times taller than it is wide; only a strip of panels is.
 */
const STRIP_ASPECT = 3;

/** Where one slice is taken from in the source picture. Matches expo-image-manipulator's crop rect. */
export type SliceRect = { originX: number; originY: number; width: number; height: number };

/**
 * Into how many pieces this picture has to be cut, 1 meaning "leave it alone".
 *
 * Equal pieces, not `MAX_DRAWABLE_PX`-sized ones with a remainder: a 9000px strip becomes three
 * 3000px slices rather than two of 4096 and a 808px offcut. The offcut is the tell — a band that
 * short reads as a rendering seam when it lands mid-panel, and it is also the one most likely to
 * be a different height from its neighbours after rounding.
 */
export function sliceCount(image: Size): number {
  if (!(image.width > 0) || !(image.height > 0)) return 1;
  if (image.height <= image.width * STRIP_ASPECT) return 1;
  if (image.height <= MAX_DRAWABLE_PX) return 1;
  return Math.ceil(image.height / MAX_DRAWABLE_PX);
}

/**
 * `count` boundaries across `total`, as whole numbers that TILE IT EXACTLY — every boundary is
 * shared by the slice above and the slice below, so there is no row of pixels dropped between two
 * slices and none drawn twice. Rounding each boundary independently (rather than rounding a slice
 * HEIGHT and multiplying) is what guarantees it: consecutive bounds differ by at most one from the
 * exact split, and they still start at 0 and end at `total`.
 */
function bounds(total: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.round((i * total) / count));
  return out;
}

/** The crop rects for `image`, in source pixels. One entry when the picture needs no slicing. */
export function sliceRects(image: Size): SliceRect[] {
  const count = sliceCount(image);
  if (count < 2) return [{ originX: 0, originY: 0, width: image.width, height: image.height }];
  const b = bounds(image.height, count);
  return b.slice(0, -1).map((originY, i) => ({
    originX: 0,
    originY,
    width: image.width,
    height: b[i + 1] - originY,
  }));
}

/**
 * The heights the slices are DRAWN at, summing to exactly `boxHeight`.
 *
 * Derived the same way as the source bounds rather than by scaling each slice's own height: a
 * per-slice scale rounds `count` times independently, and the leftovers land as a hairline of
 * backdrop between two bands — the same sub-pixel seam `reader-page`'s box rounding already exists
 * to avoid, except here there is one per cut instead of one per page.
 */
export function sliceBands(boxHeight: number, count: number): number[] {
  const b = bounds(boxHeight, count);
  return b.slice(0, -1).map((top, i) => b[i + 1] - top);
}
