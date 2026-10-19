import { describe, expect, test } from 'bun:test';

import { nextInDirection, type Rect } from './focus-geometry';

const box = (left: number, top: number, w = 100, h = 150): Rect => ({ left, top, right: left + w, bottom: top + h });
const RIGHT = { x: 1, y: 0 } as const;
const LEFT = { x: -1, y: 0 } as const;
const DOWN = { x: 0, y: 1 } as const;
const UP = { x: 0, y: -1 } as const;

const centreX = (r: Rect) => (r.left + r.right) / 2;
const centreY = (r: Rect) => (r.top + r.bottom) / 2;

describe('nextInDirection', () => {
  test('a grid moves along its rows and columns', () => {
    const from = box(0, 0);
    const options = [box(120, 170), box(120, 0), box(0, 170)];
    expect(nextInDirection(from, options, RIGHT, centreY(from))).toBe(1);
    expect(nextInDirection(from, options, DOWN, centreX(from))).toBe(2);
  });

  test('nothing behind or beside counts', () => {
    const from = box(100, 100);
    expect(nextInDirection(from, [box(0, 100)], RIGHT, centreY(from))).toBeNull();
    expect(nextInDirection(from, [box(100, 300)], RIGHT, centreY(from))).toBeNull();
    expect(nextInDirection(from, [box(100, 0)], UP, centreX(from))).toBe(0);
    expect(nextInDirection(from, [box(200, 50, 100, 300)], RIGHT, centreY(from))).toBe(0);
    expect(nextInDirection(from, [box(200, 100, 100, 300)], DOWN, centreX(from))).toBeNull();
  });

  test('a button laid over the bottom of a row is between the row and what is below', () => {
    const row = [box(0, 0), box(120, 0), box(240, 0)];
    const button = box(130, 110, 80, 40);
    const below = box(0, 200, 400, 30);
    const options = [...row, button, below];
    expect(nextInDirection(row[0]!, options, DOWN, centreX(row[0]!))).toBe(3);
    expect(nextInDirection(button, options, DOWN, centreX(button))).toBe(4);
    expect(nextInDirection(below, options, UP, centreX(button))).toBe(3);
    expect(nextInDirection(button, options, UP, centreX(button))).toBe(1);
  });

  test("the next rail's heading comes before its cards, however far left it sits", () => {
    const card = box(700, 0);
    const heading = box(20, 200, 250, 30);
    const below = box(700, 250);
    expect(nextInDirection(card, [below, heading], DOWN, centreX(card))).toBe(1);
  });

  test('the column holds across a heading', () => {
    const heading = box(20, 200, 250, 30);
    const cards = [box(20, 250), box(360, 250), box(700, 250)];
    expect(nextInDirection(heading, cards, DOWN, 750)).toBe(2);
    expect(nextInDirection(heading, cards, DOWN, centreX(heading))).toBe(0);
  });

  test('between two half-overlapping boxes in the row, the nearer to the anchor wins', () => {
    const from = box(100, 0);
    expect(nextInDirection(from, [box(20, 200), box(160, 200)], DOWN, centreX(from))).toBe(1);
  });

  test('sideways keeps to the row it set out from', () => {
    const from = box(400, 300);
    const options = [box(150, 0), box(150, 290), box(150, 600)];
    expect(nextInDirection(from, options, LEFT, centreY(from))).toBe(1);
  });
});
