import { ZOOM_EPSILON } from '@/components/reader/reader-zoom';

// Where a page's picture sits inside its viewport, and how far it may be pushed around at a given
// zoom. Pure, and marked `'worklet'` so the native gesture handlers can call it on the UI thread;
// the web pager calls the same functions from its pointer handlers, so the two readers cannot
// disagree about a page's shape.

export type Size = { width: number; height: number };
export type RestEdge = 'left' | 'right' | 'center';

/** Where a page sits when nothing is touching it — 1× for most pages; a SPREAD rests zoomed to the
 *  viewport's height, at the edge reading starts from. `content` is the picture's box at 1×,
 *  centred in the viewport, which is what any pan is clamped to. */
export type PageGeometry = { content: Size; restScale: number; restEdge: RestEdge };

/** How much further than fit-height a spread may be magnified. Replaces MAX_SCALE for a page whose
 *  rest already sits above it — 4× of a strip contained in a phone is barely the strip at full
 *  height, so the old cap would have left nothing to zoom into. */
export const WIDE_ZOOM_HEADROOM = 2;
/** How far a tap in a side zone pans a zoomed spread, as a fraction of the viewport. Short of a
 *  full width so the panel that straddled the edge is still on screen after the step. */
export const TAP_PAN_FRACTION = 0.9;
/** How far past its edge a drag on a zoomed page has to be HEADED (translation + projected
 *  velocity, see lib/gesture-release) to turn the page instead of merely stopping there. The same
 *  quarter of the width the pager asks of a swipe off the end of a chapter. */
export const ZOOMED_EDGE_TURN_FRACTION = 0.25;

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
 *  `fillWide` is the spread rule: a picture wider than it is tall rests scaled to the viewport's
 *  height rather than letterboxed across its middle, and at the edge reading starts from — the
 *  left for left-to-right, the right for right-to-left. Judged by the PICTURE's aspect, not the
 *  viewport's: an ordinary portrait page is letterboxed on a tall phone too, and resting that at
 *  fit-height would put every page behind a sideways pan. A spread that already stands the full
 *  height (a landscape screen) has nowhere to go and rests at 1× like anything else. */
export function pageGeometry(image: Size | null, viewport: Size, fillWide: boolean, rtl: boolean): PageGeometry {
  'worklet';
  const content = image && image.width > 0 && image.height > 0 ? containedSize(image, viewport) : viewport;
  const wide = image != null && fillWide && image.width > image.height;
  const restScale = wide && content.height > 0 ? viewport.height / content.height : 1;
  return restScale > ZOOM_EPSILON
    ? { content, restScale, restEdge: rtl ? 'right' : 'left' }
    : { content, restScale: 1, restEdge: 'center' };
}
