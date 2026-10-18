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
  // Past the middle and out beyond the far edge: something level with `from`, or taller beside it,
  // isn't a step that way.
  const ahead = (r: Rect) => (s > 0 ? lo(r) >= mid && hi(r) > hi(from) : hi(r) <= mid && lo(r) < lo(from));
  const gap = (r: Rect) => Math.max(0, s > 0 ? lo(r) - hi(from) : lo(from) - hi(r));
  const reach = (r: Rect) => Math.max(0, crossLo(r) - anchor, anchor - crossHi(r));
  const offCentre = (r: Rect) => Math.abs((crossLo(r) + crossHi(r)) / 2 - anchor);
  const closer = (a: Rect, b: Rect) => reach(a) - reach(b) || offCentre(a) - offCentre(b);

  const inWay = options.map((r, i) => [r, i] as const).filter(([r]) => ahead(r));
  if (!inWay.length) return null;
  const [first] = inWay.reduce((best, cur) => {
    const d = gap(cur[0]) - gap(best[0]);
    return d < 0 || (d === 0 && closer(cur[0], best[0]) < 0) ? cur : best;
  });
  const row = inWay.filter(([r]) => lo(r) < hi(first) && hi(r) > lo(first));
  return row.reduce((best, cur) => (closer(cur[0], best[0]) < 0 ? cur : best))[1];
}
