/**
 * Image-pixel → view-point mapping for the translation overlay — pure math, split out of the
 * component so the letterbox/fit-width cases are unit-testable.
 */
import type { Rect } from '../types';

/**
 * Map a region rect (in the PageTranslation's image-pixel frame) into view points inside the
 * page container. `fit='contain'` letterboxes inside width×height (ReaderPage's fit-page);
 * `fit='width'` fills the width, height following the image aspect (webtoon rows). Returns
 * null for degenerate frames or sub-2pt results not worth rendering.
 */
export function mapRegionToView(
  bbox: Rect,
  frame: { imageWidth: number; imageHeight: number },
  width: number,
  height: number,
  fit: 'contain' | 'width',
): Rect | null {
  const { imageWidth: w, imageHeight: h } = frame;
  if (w <= 0 || h <= 0) return null;
  let s: number;
  let ox = 0;
  let oy = 0;
  if (fit === 'contain') {
    s = Math.min(width / w, height / h);
    ox = (width - s * w) / 2;
    oy = (height - s * h) / 2;
  } else {
    s = width / w;
  }
  const mapped = { x: bbox.x * s + ox, y: bbox.y * s + oy, w: bbox.w * s, h: bbox.h * s };
  return mapped.w < 2 || mapped.h < 2 ? null : mapped;
}
