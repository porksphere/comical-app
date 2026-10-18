// Pure, so it can be tested without a DOM: which way a box lies from another (lib/focus-nav).

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Direction = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/** How far `to` is from `from` when moving in `dir`, or null when it isn't that way at all. Lining
 *  up across the move counts for more than being close along it, so a grid moves along its rows. */
export function directionalScore(from: Rect, to: Rect, dir: Direction): number | null {
  const horizontal = dir.x !== 0;
  const s = horizontal ? dir.x : dir.y;
  const [fLo, fHi, tLo, tHi] = horizontal
    ? [from.left, from.right, to.left, to.right]
    : [from.top, from.bottom, to.top, to.bottom];
  const [fCLo, fCHi, tCLo, tCHi] = horizontal
    ? [from.top, from.bottom, to.top, to.bottom]
    : [from.left, from.right, to.left, to.right];
  if ((tLo + tHi - fLo - fHi) * s <= 0 || (s > 0 ? tHi <= fHi : tLo >= fLo)) return null;
  const along = Math.max(0, s > 0 ? tLo - fHi : fLo - tHi);
  const across = Math.max(0, Math.max(fCLo, tCLo) - Math.min(fCHi, tCHi));
  const offCentre = Math.abs(tCLo + tCHi - fCLo - fCHi) / 2;
  return along + across * 2 + offCentre / 4;
}
