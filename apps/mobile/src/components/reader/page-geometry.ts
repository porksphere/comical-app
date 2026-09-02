import { ZOOM_EPSILON } from '@/components/reader/reader-zoom';
import type { PageFit } from '@/hooks/use-reader-settings';

// Where a page's picture sits inside its viewport, and how far it may be pushed around at a given
// zoom. Pure, and marked `'worklet'` so the native gesture handlers can call it on the UI thread;
// the web pager calls the same functions from its pointer handlers, so the two readers cannot
// disagree about a page's shape.

export type Size = { width: number; height: number };
export type RestEdge = 'left' | 'right' | 'center';
/** How one page is actually laid out — the two layouts a page can take, once `smart` has chosen. */
export type EffectiveFit = 'fit-page' | 'fit-width';

/** Which pages rest at fit-height under a page fit: none, spreads only (the spread rule), or
 *  every page (`fill-height`). */
export type FillRule = 'none' | 'wide' | 'all';

/** The layout a page takes under `pageFit`. `smart` reads the picture: a wide one (a spread) is
 *  fit-page, where the spread rule rests it at fit-height; anything else — including a page whose
 *  shape isn't known yet, since nearly every page is tall — is fit-width. `fill-height` is the
 *  fit-page layout with a rest above 1× (see `fillRule`). */
export function effectiveFit(pageFit: PageFit, image: Size | null): EffectiveFit {
  'worklet';
  if (pageFit === 'fill-height') return 'fit-page';
  if (pageFit !== 'smart') return pageFit;
  return image != null && image.width > image.height ? 'fit-page' : 'fit-width';
}

/** Which pages a page fit rests at fit-height: all of them under `fill-height`, spreads under
 *  `smart` (a smart-chosen fit-page is always a spread) and under fit-page with the spread setting
 *  on, none otherwise. */
export function fillRule(pageFit: PageFit, zoomWidePages: boolean): FillRule {
  'worklet';
  if (pageFit === 'fill-height') return 'all';
  if (pageFit === 'smart' || (pageFit === 'fit-page' && zoomWidePages)) return 'wide';
  return 'none';
}

/** Where a page sits when nothing is touching it — 1× for most pages; a SPREAD rests zoomed to the
 *  viewport's height, at the edge reading starts from. `content` is the picture's box at 1×,
 *  centred in the viewport, which is what any pan is clamped to. */
export type PageGeometry = { content: Size; restScale: number; restEdge: RestEdge };

/** How much further than fit-height a spread may be magnified. Replaces MAX_SCALE for a page whose
 *  rest already sits above it — 4× of a strip contained in a phone is barely the strip at full
 *  height, so the old cap would have left nothing to zoom into. */
export const WIDE_ZOOM_HEADROOM = 2;
/** The least fit-height has to buy, as a scale over fit-page, for an ORDINARY page to rest there
 *  under `fill-height`. A page within this of the screen's own shape just fits whole: a few
 *  percent of zoom for a few points of sideways pan is a nuisance, not a bigger page. Spreads keep
 *  the plain epsilon — the rule exists for them. */
export const FILL_HEIGHT_MIN_GAIN = 1.08;

/** The box a `contain`-fit picture occupies at 1×. */
export function containedSize(image: Size, viewport: Size): Size {
  'worklet';
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

/** The furthest the centred content may be translated either way, per axis, at `scale`, without
 *  showing what lies beyond it. Zero on an axis the content fits within — which is what locks a
 *  spread at fit-height to sideways travel, with no rule saying so. */
export function panLimits(scale: number, content: Size, viewport: Size): { x: number; y: number } {
  'worklet';
  return {
    x: Math.max(0, (content.width * scale - viewport.width) / 2),
    y: Math.max(0, (content.height * scale - viewport.height) / 2),
  };
}

/** The translation that brings a given edge of the content to the matching edge of the viewport. */
export function edgeOffset(edge: RestEdge, limitX: number): number {
  'worklet';
  return edge === 'left' ? limitX : edge === 'right' ? -limitX : 0;
}

/** A page's geometry from its picture's real dimensions (`null` until they load — a page whose
 *  shape is unknown is taken to fill the viewport, which is what its placeholder does).
 *
 *  A page the `fill` rule covers rests scaled to the viewport's height rather than letterboxed
 *  across its middle, and at the edge reading starts from — the left for left-to-right, the right
 *  for right-to-left. Under `'wide'` that is the spread rule, judged by the PICTURE's aspect, not
 *  the viewport's: an ordinary portrait page is letterboxed on a tall phone too, and resting that
 *  at fit-height would put every page behind a sideways pan. Under `'all'` it is every page —
 *  `fill-height` — but only where it buys more than FILL_HEIGHT_MIN_GAIN; a page near the screen's
 *  shape fits whole. A page that already stands the full height (a spread on a landscape screen)
 *  has nowhere to go and rests at 1× like anything else. */
export function pageGeometry(image: Size | null, viewport: Size, fill: FillRule, rtl: boolean): PageGeometry {
  'worklet';
  const content = image && image.width > 0 && image.height > 0 ? containedSize(image, viewport) : viewport;
  const wide = image != null && image.width > image.height;
  const fills = image != null && (fill === 'all' || (fill === 'wide' && wide));
  const restScale = fills && content.height > 0 ? viewport.height / content.height : 1;
  const minGain = wide ? ZOOM_EPSILON : FILL_HEIGHT_MIN_GAIN;
  return restScale > minGain
    ? { content, restScale, restEdge: rtl ? 'right' : 'left' }
    : { content, restScale: 1, restEdge: 'center' };
}
