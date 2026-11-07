// Kept free of React Native so a test can run it.

import type { SpreadFill } from '@/hooks/use-reader-settings';

export type Side = 'left' | 'right';
const across = (side: Side): Side => (side === 'left' ? 'right' : 'left');

/**
 * Where a page of a spread sits in its half, and which side of it is filled (`SpreadFill`), given
 * the side of the half the spine is on: against the spine with nothing beside it, against the spine
 * with the outer side filled, or against the screen's edge with the gutter filled.
 */
export function halfLayout(spine: Side, fill: SpreadFill): { hug: Side; filled: Side | null } {
  if (fill === 'middle') return { hug: across(spine), filled: spine };
  return { hug: spine, filled: fill === 'sides' ? across(spine) : null };
}

/**
 * The colours along a page's edges, counted: each a bucket of nearby colours (`SHIFT` drops the low
 * bits of each channel, so paper's speckle and a JPEG's ringing count as one colour), with how many
 * pixels fell in it and their sums, for the bucket's exact average.
 */
export type EdgeColors = { key: number; n: number; r: number; g: number; b: number }[];

const SHIFT = 5;
/** The buckets kept per page: the rest are too rare to win a spread. */
const KEEP = 12;

/**
 * Count the colours in the strip `depth` pixels wide just inside one `side` of a picture
 * `width`×`height` (RGBA rows), `inset` pixels in from the edge, past a trimmer's line.
 */
export function edgeColors(
  px: ArrayLike<number>,
  width: number,
  height: number,
  inset: number,
  depth: number,
  side: Side,
): EdgeColors {
  const buckets = new Map<number, { key: number; n: number; r: number; g: number; b: number }>();
  const columns: number[] = [];
  for (let i = 0; i < depth; i++) columns.push(side === 'left' ? inset + i : width - 1 - inset - i);
  for (let y = 0; y < height; y++) {
    for (const x of columns) {
      if (x < 0 || x >= width) continue;
      const o = (y * width + x) * 4;
      const r = px[o]!;
      const g = px[o + 1]!;
      const b = px[o + 2]!;
      const key = ((r >> SHIFT) << 6) | ((g >> SHIFT) << 3) | (b >> SHIFT);
      const bucket = buckets.get(key) ?? { key, n: 0, r: 0, g: 0, b: 0 };
      bucket.n += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, KEEP);
}

const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');

/**
 * The colour padding takes from the edges it is beside: the most frequent along all of them, as
 * the average of the pixels that made it so. A white margin wins even where a drawing reaches the
 * edge here and there. Null with nothing counted.
 */
export function spreadColor(pages: (EdgeColors | null | undefined)[]): string | null {
  const merged = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const page of pages) {
    for (const bucket of page ?? []) {
      const into = merged.get(bucket.key) ?? { n: 0, r: 0, g: 0, b: 0 };
      into.n += bucket.n;
      into.r += bucket.r;
      into.g += bucket.g;
      into.b += bucket.b;
      merged.set(bucket.key, into);
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bucket of merged.values()) if (!best || bucket.n > best.n) best = bucket;
  return best ? `#${hex(best.r / best.n)}${hex(best.g / best.n)}${hex(best.b / best.n)}` : null;
}
