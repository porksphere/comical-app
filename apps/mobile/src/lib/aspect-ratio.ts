import type { ImageStyle } from 'react-native';

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


/** What a row needs to know about a card: the cover shape its bridge reported, and whether it is a
 *  redacted placeholder. */
export type CoverShaped = { coverAspect?: number; excluded?: boolean };

/**
 * The cover shape a ROW of cards is laid out at: its tallest cover, as width / height. A card only
 * counts as shorter than the 2:3 maximum when its bridge said so (`coverAspect`); one that didn't —
 * or a redacted placeholder, which always draws 2:3 — holds the row at the full 2:3 height, exactly
 * as every row was before covers carried a shape. So rows can only ever get shorter than that, and
 * only when every card in them is known to be shorter.
 *
 * Known up front, before a single image loads, so a grid can hand its list exact row heights — no
 * row is ever measured or re-laid-out as covers arrive.
 */
export function rowCoverAspect(entries: readonly CoverShaped[]): number {
  let aspect = Infinity;
  for (const e of entries) aspect = Math.min(aspect, e.excluded ? DEFAULT_THUMB_ASPECT : clampThumbAspect(e.coverAspect));
  return Number.isFinite(aspect) ? aspect : DEFAULT_THUMB_ASPECT;
}

/** `rowCoverAspect` for every row of a `numColumns`-wide grid of `entries`, top to bottom. */
export function rowCoverAspects(entries: readonly CoverShaped[], numColumns: number): number[] {
  const rows: number[] = [];
  for (let i = 0; i < entries.length; i += numColumns) rows.push(rowCoverAspect(entries.slice(i, i + numColumns)));
  return rows;
}

/**
 * The picture at its own shape, scaled to cover a box of `box` aspect and centred — the clip crops it.
 *
 * Web only, and not cosmetic: `object-fit: cover` draws a SUBSET of the image, and Chromium filters a
 * subset draw without mipmaps. A full reader page squeezed several times into a tile that way samples
 * its screentone and line art point by point, which comes out as harsh blotches and jagged lettering;
 * the same draw over the whole image is mipmapped and smooth. Pair it with `contentFit="fill"`, inside
 * an `overflow: hidden` ancestor.
 */
export function wholePictureStyle(picture: number, box: number): ImageStyle {
  if (picture < box) {
    const height = (box / picture) * 100;
    return { position: 'absolute', left: 0, width: '100%', height: `${height}%`, top: `${(100 - height) / 2}%` };
  }
  const width = (picture / box) * 100;
  return { position: 'absolute', top: 0, height: '100%', width: `${width}%`, left: `${(100 - width) / 2}%` };
}
