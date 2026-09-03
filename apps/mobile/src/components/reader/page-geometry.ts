import { ZOOM_EPSILON } from '@/components/reader/reader-zoom';
import type { PageFit } from '@/hooks/use-reader-settings';

// Where a page's picture sits inside its viewport, and how far it may be pushed around at a given
// zoom. Pure, and marked `'worklet'` so the native gesture handlers can call it on the UI thread;
// the web pager calls the same functions from its pointer handlers, so the two readers cannot
// disagree about a page's shape.

export type Size = { width: number; height: number };
export type RestEdge = 'left' | 'right' | 'center';
/** How one page is actually laid out — the two layouts a page can take. */
export type EffectiveFit = 'fit-page' | 'fit-width';

/** Which pages rest at fit-height under a page fit: none, spreads alone (`auto`), or every page
 *  (`fit-height`). */
export type FillRule = 'none' | 'wide' | 'all';

/** The layout a page takes under `pageFit`. `auto` and `fit-height` are drawn as the contain
 *  layout (`'fit-page'`) with a rest above 1× where the rule says (see `fillRule`); `fit-width`
 *  is its own top-aligned layout, scrolled where the page is taller than the screen. */
export function effectiveFit(pageFit: PageFit): EffectiveFit {
  'worklet';
  return pageFit === 'fit-width' ? 'fit-width' : 'fit-page';
}

/** Which pages a page fit rests at fit-height: all of them under `fit-height`, spreads alone
 *  under `auto`, none under fit-width — a spread lies as a strip there, and the switch-fit
 *  double-tap is how it is read. */
export function fillRule(pageFit: PageFit): FillRule {
  'worklet';
  return pageFit === 'fit-height' ? 'all' : pageFit === 'auto' ? 'wide' : 'none';
}

/** The axis a `switch-fit` double-tap takes a page to: the one it does NOT currently fill. From a
 *  fixed axis that is simply the other one. From `auto` it depends on the page: a spread already
 *  fills the height, so it goes to the width (a strip); anything else fills whichever axis contain
 *  limited it on this screen — the width for an ordinary page on a phone — so it goes to the
 *  other. A page whose shape isn't known yet is taken for an ordinary one. */
export function otherFit(pageFit: PageFit, image: Size | null, viewport: Size): 'fit-width' | 'fit-height' {
  'worklet';
  if (pageFit === 'fit-width') return 'fit-height';
  if (pageFit === 'fit-height') return 'fit-width';
  if (image == null || image.width <= 0 || image.height <= 0) return 'fit-height';
  if (image.width > image.height) return 'fit-width';
  return image.width / image.height >= viewport.width / viewport.height ? 'fit-height' : 'fit-width';
}

/** Where a page sits when nothing is touching it — 1× for most pages; a SPREAD rests zoomed to the
 *  viewport's height, at the edge reading starts from. `content` is the picture's box at 1×,
 *  centred in the viewport, which is what any pan is clamped to. */
export type PageGeometry = { content: Size; restScale: number; restEdge: RestEdge };

/** How much further than fit-height a spread may be magnified. Replaces MAX_SCALE for a page whose
 *  rest already sits above it — 4× of a strip contained in a phone is barely the strip at full
 *  height, so the old cap would have left nothing to zoom into. */
export const WIDE_ZOOM_HEADROOM = 2;
/** The least fit-height has to buy, as a scale over the contain fit, for an ORDINARY page to rest
 *  there under `fit-height`. A page within this of the screen's own shape just fits whole: a few
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

/** The edge a page is ENTERED from when it is swiped back onto: the far one. A page before the
 *  one being read rests here, so a backward swipe lands where reading left off — decided from
 *  where the page sits, never from history, so it holds for a chapter resumed from the middle. */
export function farEdge(edge: RestEdge): RestEdge {
  'worklet';
  return edge === 'left' ? 'right' : edge === 'right' ? 'left' : edge;
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
 *  for right-to-left. Under `'wide'` (`auto`) that is a spread alone — a picture wider than it is
 *  tall, judged by the PICTURE's aspect, never the viewport's: an ordinary portrait page is
 *  letterboxed on a tall phone too. Under `'all'` (`fit-height`) it is every page, but only where
 *  that buys more than FILL_HEIGHT_MIN_GAIN; a page near the screen's shape fits whole. A spread
 *  keeps the plain epsilon, since fitting the height is the whole point for it. A page that
 *  already stands the full height (a spread on a landscape screen) has nowhere to go and rests at
 *  1× like anything else. */
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
