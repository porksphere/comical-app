import { ZOOM_EPSILON } from '@/components/reader/reader-zoom';
import type { PageFit } from '@/hooks/use-reader-settings';

// How a page is LAID OUT in its viewport, from its picture's real dimensions — the box the
// picture is drawn in, and which of its edges sits against the viewport's when it overflows —
// and how far a box may be pushed around at a given zoom. Pure, and marked `'worklet'` so the
// native gesture handlers can call it on the UI thread; the web pager calls the same functions
// from its pointer handlers, so the two readers cannot disagree about a page's shape.
//
// The fit is a LAYOUT, not a zoom: a fit-height page on a phone is a box wider than the screen,
// drawn at that width, with the transform left at 1× for pinch and magnify. Drawing it at the
// contain size and scaling it up instead was tried first, and it does three things wrong at once:
// the picture is decoded for the smaller box and upscaled on screen, every change of fit becomes
// an animation of scale and offset rather than a relayout, and every fit-height page counts as
// "zoomed" for the pager and the dismiss.

export type Size = { width: number; height: number };
/** Which edge of an overflowing box sits against the viewport's at rest: the reading edge for a
 *  sideways overflow, the top for a vertical one, nothing for a box that fits. */
export type PageEdge = 'left' | 'right' | 'top' | 'center';
export type PageLayout = { box: Size; edge: PageEdge };

/** The least a fit has to buy, as a scale over the contain fit, for an ORDINARY page to overflow
 *  rather than fit whole. A page within this of the screen's own shape just fits: a few percent
 *  of overflow for a few points of pan is a nuisance, not a bigger page. Spreads keep the plain
 *  epsilon — the spread rule exists for them. */
export const FIT_MIN_GAIN = 1.08;

/** The box a `contain`-fit picture occupies at 1×. */
export function containedSize(image: Size, viewport: Size): Size {
  'worklet';
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

/** The furthest a centred box may be translated either way, per axis, at `scale`, without
 *  showing what lies beyond it. Zero on an axis the box fits within — which is what holds a
 *  fit-height page to sideways travel, with no rule saying so. */
export function panLimits(scale: number, box: Size, viewport: Size): { x: number; y: number } {
  'worklet';
  return {
    x: Math.max(0, (box.width * scale - viewport.width) / 2),
    y: Math.max(0, (box.height * scale - viewport.height) / 2),
  };
}

/** The translation that brings a given edge of a centred box to the matching edge of the viewport. */
export function edgeOffset(edge: PageEdge, limit: { x: number; y: number }): { x: number; y: number } {
  'worklet';
  return {
    x: edge === 'left' ? limit.x : edge === 'right' ? -limit.x : 0,
    y: edge === 'top' ? limit.y : 0,
  };
}

/** A page's layout from its picture's real dimensions (`null` until they load — a page whose
 *  shape is unknown fills the viewport, which is what its placeholder does).
 *
 *  `pageFit` is the axis the picture is fitted to; the other axis is whatever its shape makes it,
 *  and where that overflows the viewport the box sits at its reading edge — the left for
 *  left-to-right, the right for right-to-left, the top for a vertical overflow. `'contain'` fits
 *  both, for a page that has to match a contain-drawn stand-in. `zoomWidePages` is the spread
 *  rule under fit-width: a picture wider than it is tall — judged by the PICTURE's aspect, never
 *  the viewport's, since an ordinary portrait page is letterboxed on a tall phone too — fits the
 *  height instead of lying as a strip across the middle. */
export function pageLayout(
  image: Size | null,
  viewport: Size,
  pageFit: PageFit | 'contain',
  zoomWidePages: boolean,
  rtl: boolean,
): PageLayout {
  'worklet';
  if (image == null || image.width <= 0 || image.height <= 0) return { box: viewport, edge: 'center' };
  const contain = containedSize(image, viewport);
  if (pageFit === 'contain') return { box: contain, edge: 'center' };
  const wide = image.width > image.height;
  const aspect = image.width / image.height;
  const axis = pageFit === 'fit-height' || (zoomWidePages && wide) ? 'height' : 'width';
  const fitted: Size =
    axis === 'height'
      ? { width: viewport.height * aspect, height: viewport.height }
      : { width: viewport.width, height: viewport.width / aspect };
  const gain = fitted.width / contain.width;
  if (gain <= (wide ? ZOOM_EPSILON : FIT_MIN_GAIN)) return { box: contain, edge: 'center' };
  return { box: fitted, edge: axis === 'height' ? (rtl ? 'right' : 'left') : 'top' };
}
