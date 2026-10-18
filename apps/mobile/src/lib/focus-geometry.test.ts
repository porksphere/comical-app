import { describe, expect, test } from 'bun:test';

import { directionalScore, type Rect } from './focus-geometry';

const box = (left: number, top: number, w = 100, h = 150): Rect => ({ left, top, right: left + w, bottom: top + h });
const RIGHT = { x: 1, y: 0 } as const;
const DOWN = { x: 0, y: 1 } as const;
const UP = { x: 0, y: -1 } as const;

const pick = (from: Rect, dir: Parameters<typeof directionalScore>[2], options: Rect[]) => {
  const scored = options.map((r, i) => [directionalScore(from, r, dir), i] as const).filter(([s]) => s !== null);
  scored.sort((a, b) => a[0]! - b[0]!);
  return scored[0]?.[1] ?? null;
};

describe('directionalScore', () => {
  test('a grid moves along its rows and columns', () => {
    const from = box(0, 0);
    const right = box(120, 0);
    const below = box(0, 170);
    const diagonal = box(120, 170);
    expect(pick(from, RIGHT, [diagonal, right, below])).toBe(1);
    expect(pick(from, DOWN, [diagonal, right, below])).toBe(2);
  });

  test('nothing behind or beside counts', () => {
    const from = box(100, 100);
    expect(directionalScore(from, box(0, 100), RIGHT)).toBeNull();
    expect(directionalScore(from, box(100, 300), RIGHT)).toBeNull();
    expect(directionalScore(from, box(100, 0), UP)).not.toBeNull();
  });

  test('lined up but further beats close but off to the side', () => {
    const from = box(0, 0);
    expect(pick(from, DOWN, [box(300, 160), box(0, 400)])).toBe(1);
  });

  test('between two half-overlapping rows, the nearer centre wins', () => {
    const from = box(100, 0);
    expect(pick(from, DOWN, [box(20, 200), box(160, 200)])).toBe(1);
  });
});
