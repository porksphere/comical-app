// Shared zoom primitives for the web readers (paged + webtoon). Kept platform-
// agnostic and worklet-free; the native readers have their own reanimated copies.

export const MAX_SCALE = 4;
// At or below this we treat the content as "not zoomed" and snap back to 1×.
export const ZOOM_EPSILON = 1.01;

// Double-tap-to-zoom, shared by both web readers.
export const DOUBLE_TAP_SCALE = 2.5; // scale a double-tap zooms into
export const DOUBLE_TAP_MS = 280; // max gap between the two taps to count as a double
export const DOUBLE_TAP_DIST = 40; // px; the second tap must land near the first

export type Point = { x: number; y: number };

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
