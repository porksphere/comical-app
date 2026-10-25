// Pure, so it can be tested without a DOM: where a move lands among boxes on screen (lib/focus-nav).

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Direction = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/**
 * The box a move `dir`'s way lands on, as an index into `options`, or null when nothing lies that
 * way. A move goes to the nearest ROW in that direction (the nearest box and everything level with
 * it), and only then picks within the row, by `anchor`: the cross-axis position the moves set out
 * from. So down from a card reaches the heading of the next rail before its cards, however far to
 * the left the heading starts, and a run of moves keeps to its column instead of drifting toward
 * whatever each row happens to put closest.
 */
export function nextInDirection(from: Rect, options: readonly Rect[], dir: Direction, anchor: number): number | null {
  const horizontal = dir.x !== 0;
  const s = horizontal ? dir.x : dir.y;
  const lo = (r: Rect) => (horizontal ? r.left : r.top);
  const hi = (r: Rect) => (horizontal ? r.right : r.bottom);
  const crossLo = (r: Rect) => (horizontal ? r.top : r.left);
  const crossHi = (r: Rect) => (horizontal ? r.bottom : r.right);
  const mid = (lo(from) + hi(from)) / 2;
  const centre = (r: Rect) => (lo(r) + hi(r)) / 2;
  // Past the middle and out to the far edge: something level with `from`, or taller beside it,
  // isn't a step that way. One that only reaches the far edge counts — a button laid over the
  // bottom of a row, flush with it, is the next thing down.
  const past = (r: Rect) => (s > 0 ? lo(r) >= mid && hi(r) >= hi(from) : hi(r) <= mid && lo(r) <= lo(from));
  // `from` is laid over part of `r`, and the rest of `r` lies that way: back off the overlay onto
  // what it covers.
  const overlaps = (r: Rect) =>
    crossLo(r) < crossHi(from) && crossHi(r) > crossLo(from) && lo(r) < hi(from) && hi(r) > lo(from);
  const behind = (r: Rect) =>
    overlaps(r) &&
    (s > 0
      ? lo(r) <= lo(from) && hi(r) > hi(from) && centre(r) > mid
      : hi(r) >= hi(from) && lo(r) < lo(from) && centre(r) < mid);
  const ahead = (r: Rect) => past(r) || behind(r);
  const gap = (r: Rect) => Math.max(0, s > 0 ? lo(r) - hi(from) : lo(from) - hi(r));
  const reach = (r: Rect) => Math.max(0, crossLo(r) - anchor, anchor - crossHi(r));
  const offCentre = (r: Rect) => Math.abs((crossLo(r) + crossHi(r)) / 2 - anchor);
  const closer = (a: Rect, b: Rect) => reach(a) - reach(b) || offCentre(a) - offCentre(b);

  // Sideways only reaches what is level with `from`. Otherwise the nearest column is found down the
  // whole list, and a box in another row that starts a few points nearer — the top bar's logo above
  // a first card, a row whose columns don't line up, anything at all past a row's end — takes the
  // move off the row.
  const level = (r: Rect) => !horizontal || (crossLo(r) < crossHi(from) && crossHi(r) > crossLo(from));
  const inWay = options.map((r, i) => [r, i] as const).filter(([r]) => ahead(r) && level(r));
  if (!inWay.length) return null;
  const [first] = inWay.reduce((best, cur) => {
    const d = gap(cur[0]) - gap(best[0]);
    return d < 0 || (d === 0 && closer(cur[0], best[0]) < 0) ? cur : best;
  });
  const row = inWay.filter(([r]) => lo(r) < hi(first) && hi(r) > lo(first));
  // A box drawn inside another — Show all over the bottom of the row it fades, a card's menu button
  // in its corner. Along the edge the move comes in over, it is the first thing met, wherever the
  // anchor is; anywhere else it is part of the box it sits in, and the move lands on that box.
  const inside = (r: Rect, c: Rect) =>
    r !== c && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom;
  const entry = (r: Rect) => (s > 0 ? lo(r) : hi(r));
  const holder = (r: Rect) => row.find(([c]) => inside(r, c))?.[0];
  const onEdge = row.filter(([r]) => {
    const c = holder(r);
    return !!c && Math.abs(entry(r) - entry(c)) <= 1;
  });
  const whole = row.filter(([r]) => !holder(r));
  const pick = onEdge.length ? onEdge : whole.length ? whole : row;
  // Level, as near the anchor: the one whose middle is nearer, which is the one laid over the other.
  const nearer = (a: Rect, b: Rect) => closer(a, b) || s * (centre(a) - centre(b));
  return pick.reduce((best, cur) => (nearer(cur[0], best[0]) < 0 ? cur : best))[1];
}
