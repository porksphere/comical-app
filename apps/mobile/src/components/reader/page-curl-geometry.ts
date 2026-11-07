import { containedSize, pageRest, type Size } from '@/components/reader/page-geometry';
import type { PageFit } from '@/hooks/use-reader-settings';

// The geometry of a page curl (`page-curl.tsx`): what turns, the shape it has, and where the curl
// lies for a given pull. Pure, and marked `'worklet'` where the pull runs on the UI thread.
//
// Everything about a turn is worked out in TURN SPACE, where the leaf always lies to the right of
// the spine and is carried over to the left of it. A turn that goes the other way across the screen
// (back a page, or forward right to left) is the same turn mirrored about the screen's middle, and
// the renderer mirrors the pictures it samples to match — one set of arithmetic, not four.

export type Box = { x: number; y: number; width: number; height: number };
/** A radius per corner, clockwise from the top left. */
export type Radii = readonly [number, number, number, number];

export const SQUARE: Radii = [0, 0, 0, 0];

/**
 * What turns, in turn space: the leaf's box and its corners, and the spine it is bound to. A two
 * page leaf (`dual`) is printed on both sides — its back is the facing page of the spread it turns
 * to — and a one page leaf is paper, the page showing faintly through it.
 */
export type Leaf = { box: Box; radii: Radii; spine: number; dual: boolean };

/** Where the curl lies for one pull, as the renderer takes it: the unit normal of the fold toward
 *  the leaf's free edge, the fold line as `dot(p, n) = c`, the radius the paper rolls over, and how
 *  much of the curl's shading to draw (none at rest, so a turn begins and ends on the plain page). */
export type CurlFrame = { nx: number; ny: number; c: number; r: number; shade: number };

/** The frame of a leaf lying flat where it started. */
export const FLAT: CurlFrame = { nx: 1, ny: 0, c: 1e6, r: 0, shade: 0 };

export function mirrorBox(box: Box, width: number): Box {
  'worklet';
  return { x: width - box.x - box.width, y: box.y, width: box.width, height: box.height };
}

export function mirrorRadii([tl, tr, br, bl]: Radii): Radii {
  'worklet';
  return [tr, tl, bl, br];
}

export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * A corner nested inside a rounded one follows it as far as it reaches into it, and is square once
 * it is inset past it: the display's radius less the corner's inset from the display's corner. iOS
 * rounds a view nested in the screen the same way (its concentric corners), so a page that fills
 * its half of the screen turns with the screen's own rounded corners and a page well inside it
 * turns square.
 */
export function concentric(radius: number, dx: number, dy: number): number {
  return Math.max(0, radius - Math.max(dx, dy));
}

/** The corners of `box` inside a viewport whose own corners are `viewport`; `squareLeft` and
 *  `squareRight` are a spine's side, which is never rounded. */
export function leafRadii(box: Box, size: Size, viewport: Radii, squareLeft = false, squareRight = false): Radii {
  const left = box.x;
  const top = box.y;
  const right = size.width - box.x - box.width;
  const bottom = size.height - box.y - box.height;
  return [
    squareLeft ? 0 : concentric(viewport[0], left, top),
    squareRight ? 0 : concentric(viewport[1], right, top),
    squareRight ? 0 : concentric(viewport[2], right, bottom),
    squareLeft ? 0 : concentric(viewport[3], left, bottom),
  ];
}

/**
 * Where a lone page is drawn at rest, clipped to the screen: its contain box, scaled by the rest the
 * page fit gives it. A page resting magnified (a spread at fit-height) or a strip overflows, and the
 * screen is then the leaf. Unknown shapes are taken as filling it.
 */
export function singlePageBox(image: Size | null, viewport: Size, pageFit: PageFit, rtl: boolean): Box {
  const screen = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  if (!image) return screen;
  const rest = pageRest(image, viewport, pageFit, false, rtl, false);
  if (rest.strip || rest.restScale > 1) return screen;
  const { width, height } = rest.content;
  return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height };
}

/** One half of a two-page spread at rest: the page contained in its half, against the spine. */
export function halfPageBox(image: Size | null, viewport: Size, side: 'left' | 'right'): Box {
  const half = viewport.width / 2;
  const frame = { x: side === 'left' ? 0 : half, y: 0, width: half, height: viewport.height };
  if (!image) return frame;
  const { width, height } = containedSize(image, { width: half, height: viewport.height });
  return { x: side === 'left' ? half - width : half, y: (viewport.height - height) / 2, width, height };
}

/**
 * The leaf of a turn, in turn space.
 *
 * `turning` is the box, on screen, of what is lifted: a lone page, or in a spread the page on the
 * side the turn starts from. `mirrored` says the turn runs left to right across the screen, so it is
 * flipped into turn space. A spread's leaf runs from the spine to the page's outer edge — the page
 * itself when the pages meet at the spine, as they are drawn — and is square along the spine; a
 * lone page is bound along its own inner edge.
 */
export function makeLeaf(
  turning: Box,
  viewport: Size,
  display: Radii,
  dual: boolean,
  mirrored: boolean,
): Leaf {
  const box = mirrored ? mirrorBox(turning, viewport.width) : turning;
  const corners = mirrored ? mirrorRadii(display) : display;
  if (!dual) return { box, radii: leafRadii(box, viewport, corners), spine: box.x, dual };
  const spine = viewport.width / 2;
  const right = Math.max(spine + 1, box.x + box.width);
  const leaf = { x: spine, y: box.y, width: right - spine, height: box.height };
  return { box: leaf, radii: leafRadii(leaf, viewport, corners, true), spine, dual };
}

/** Where the free edge is taken from, for a pull at height `y`: the leaf's outer edge. */
export function grabPoint(leaf: Leaf, y: number): { x: number; y: number } {
  'worklet';
  const { box } = leaf;
  return { x: box.x + box.width, y: Math.min(box.y + box.height, Math.max(box.y, y)) };
}

/** Where the free edge lands, turned all the way over: mirrored about the spine. */
export function landingPoint(leaf: Leaf, y: number): { x: number; y: number } {
  'worklet';
  const grab = grabPoint(leaf, y);
  return { x: 2 * leaf.spine - grab.x, y: grab.y };
}

/** How far through the turn a pull at `x` is: 0 lying flat, 1 turned all the way over. */
export function turnProgress(leaf: Leaf, x: number): number {
  'worklet';
  const from = leaf.box.x + leaf.box.width;
  const to = 2 * leaf.spine - from;
  return Math.min(1, Math.max(0, (from - x) / Math.max(1, from - to)));
}

/** The radius the paper rolls over at its most, in the leaf's widths. */
export const CURL_RADIUS = 0.035;
/** How far from either end of the turn the curl's shading has faded out, in the leaf's widths. */
const SHADE_REACH = 0.15;

/**
 * Where the curl lies for the leaf's free edge, taken at height `grabY`, pulled to (`x`, `y`).
 *
 * The paper rolls over a cylinder lying on the page: flat behind the fold, around the cylinder, then
 * back over the top. The free edge is a point of the paper, so the fold sits where carrying it from
 * where it was taken to the finger puts it — halfway between, less half the cylinder's arc. The
 * cylinder grows from nothing as the pull starts and shrinks to nothing as it lands, so the paper
 * leaves and arrives flat.
 *
 * A leaf is bound at its spine and can't be pulled off it: the pull is held no further from either
 * end of the spine than the free edge started, which is what keeps the spine's corners on the page
 * whatever the finger does — the arc a turned page swings through.
 */
export function curlFrame(leaf: Leaf, grabY: number, x: number, y: number): CurlFrame {
  'worklet';
  const { box, spine } = leaf;
  const grab = grabPoint(leaf, grabY);
  const top = box.y;
  const bottom = box.y + box.height;
  let fx = x;
  let fy = y;
  // Into both discs at once: alternating projections settle on their intersection in a few rounds.
  for (let round = 0; round < 6; round++) {
    for (let end = 0; end < 2; end++) {
      const sy = end === 0 ? top : bottom;
      const limit = Math.hypot(grab.x - spine, grab.y - sy);
      const dx = fx - spine;
      const dy = fy - sy;
      const d = Math.hypot(dx, dy);
      if (d > limit && d > 0) {
        fx = spine + (dx * limit) / d;
        fy = sy + (dy * limit) / d;
      }
    }
  }
  const gx = grab.x - fx;
  const gy = grab.y - fy;
  const gap = Math.hypot(gx, gy);
  if (gap < 0.5) return FLAT;
  const land = landingPoint(leaf, grabY);
  const toLand = Math.hypot(fx - land.x, fy - land.y);
  const r = Math.min(CURL_RADIUS * box.width, gap / Math.PI, toLand * 0.35);
  const nx = gx / gap;
  const ny = gy / gap;
  // The cylinder sits half its arc nearer the finger than a flat fold would, which on a pull held
  // at the limit would put the spine's ends on it: the fold goes no nearer than through them.
  const c = Math.max(
    (fx * nx + fy * ny + grab.x * nx + grab.y * ny - Math.PI * r) / 2,
    spine * nx + top * ny,
    spine * nx + bottom * ny,
  );
  const reach = SHADE_REACH * box.width;
  const shade = Math.min(1, gap / reach) * Math.min(1, toLand / reach);
  return { nx, ny, c, r, shade };
}

/** How far a turning edge rises at `t` through the turn, as a hand turning a page lifts it: none
 *  lying flat or landed, most half way over — and rising from nothing, flat at the start. The fold
 *  stands across the line from where the edge was taken to where it is, so a lift that rose as fast
 *  as the edge went across tilted the fold from the first point: through the edge at the finger's
 *  height, a tilt that cut a corner sixty points deep off the far end of the page on the drag's
 *  first frame. */
export function turnLift(leaf: Leaf, t: number): number {
  'worklet';
  const s = Math.sin(Math.PI * t);
  return s * s * leaf.box.height * 0.08;
}

/**
 * Where the finger would be at `t` through a turn nobody is dragging — a tap, a key, a released
 * drag finishing on its own: the free edge carried from where it lies flat (t = 0) to where it lands
 * (t = 1), lifting a little on the way.
 */
export function turnPull(leaf: Leaf, grabY: number, t: number): { x: number; y: number } {
  'worklet';
  const grab = grabPoint(leaf, grabY);
  const land = landingPoint(leaf, grabY);
  return { x: grab.x + (land.x - grab.x) * t, y: grab.y - turnLift(leaf, t) };
}

/** Where a tap's turn takes the page from: low on the free edge, the corner a thumb lifts. */
export const TAP_GRAB = 0.82;
/**
 * The most a drag's vertical travel leans the fold, in radians, and the travel that takes it most
 * of the way there. The turn is a sideways gesture: a thumb's arc should lean the fold a little,
 * never steer it. An angle, not a share of the travel: a share moved the edge by points, and early
 * in a drag, a few points from where it started, a few points up swung the fold through a steep
 * diagonal.
 */
export const MAX_TILT = (6 * Math.PI) / 180;
const TILT_TRAVEL = 160;

/** The finger travel over which a drag's turn eases in, the fold growing from nothing. */
export const DRAG_EASE_PX = 24;

/**
 * How far a drag carries the page for `travel` of the finger the way the turn goes: eased in over
 * the first `DRAG_EASE_PX` (quadratic, so the page starts at rest and moving with the finger's
 * pace by the end of it), then one for one, half of that behind. The drag only activates once the
 * finger is ten points in, and carried one for one from the first point, the page was drawn with a
 * corner already ten points over on its first frame, a snap. Travel against the turn is left as it
 * is: the page's own travel holds it flat (`dragPull`).
 */
export function dragTravel(travel: number): number {
  'worklet';
  if (travel <= 0) return travel;
  return travel < DRAG_EASE_PX ? (travel * travel) / (2 * DRAG_EASE_PX) : travel - DRAG_EASE_PX / 2;
}

/** The height a drag that starts at `y` takes the free edge from: the finger's own, held to the
 *  page, as the page under a finger is the one it turns — low, the thumb's corner lifts; mid-way,
 *  the whole page comes over on an upright fold; high, the top corner. (Taken mostly from the tap's
 *  corner whatever the finger's height, the curl ran well below the finger.) */
export function dragGrabY(leaf: Leaf, y: number): number {
  'worklet';
  return Math.min(leaf.box.y + leaf.box.height, Math.max(leaf.box.y, y));
}

/**
 * Where a drag puts the free edge: carried across by the finger's sideways travel `tx` (in turn
 * space) from where the turn starts (`fromX`), lifting as a tap's turn does, and leaned by its
 * vertical travel `ty` through at most `MAX_TILT`.
 */
export function dragPull(leaf: Leaf, grabY: number, fromX: number, tx: number, ty: number): { x: number; y: number } {
  'worklet';
  // Held to the page's travel: a finger brought back past where it began can't push the page out
  // past flat, nor past where it lands turned, any more than a hand can push paper into a book.
  const from = leaf.box.x + leaf.box.width;
  const to = 2 * leaf.spine - from;
  const x = Math.min(from, Math.max(to, fromX + tx));
  const grab = grabPoint(leaf, grabY);
  const lean = Math.tan(MAX_TILT * Math.tanh(ty / TILT_TRAVEL));
  return { x, y: grab.y - turnLift(leaf, turnProgress(leaf, x)) + Math.abs(grab.x - x) * lean };
}
