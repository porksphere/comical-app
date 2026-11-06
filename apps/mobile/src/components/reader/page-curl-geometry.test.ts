import { describe, expect, test } from 'bun:test';

import {
  FLAT,
  concentric,
  curlFrame,
  halfPageBox,
  landingPoint,
  leafRadii,
  makeLeaf,
  mirrorRadii,
  singlePageBox,
  turnProgress,
  turnPull,
  type Leaf,
} from './page-curl-geometry';

const PAGE = { width: 800, height: 1107 };
const PHONE = { width: 390, height: 844 };
const DUO_OPEN = { width: 890, height: 626 };

// The free edge is a point of the paper: where it ends up is the mirror of where it started across
// the fold line, the cylinder's arc aside. With no cylinder that's the whole relation.
const sideOf = (f: { nx: number; ny: number; c: number }, x: number, y: number) => x * f.nx + y * f.ny - f.c;

describe('concentric corners', () => {
  test('follow the display as far as the corner reaches into it', () => {
    expect(concentric(44, 0, 0)).toBe(44);
    expect(concentric(44, 0, 5)).toBe(39);
    expect(concentric(44, 60, 0)).toBe(0);
  });

  test('a page well inside a phone turns square', () => {
    const box = singlePageBox(PAGE, PHONE, 'auto', false);
    expect(leafRadii(box, PHONE, [55, 55, 55, 55])).toEqual([0, 0, 0, 0]);
  });

  test("a page filling the open Duo's half takes its outer corners and is square at the fold", () => {
    const box = halfPageBox(PAGE, DUO_OPEN, 'right');
    const leaf = makeLeaf(box, DUO_OPEN, [44, 44, 44, 44], true, false);
    expect(leaf.radii[0]).toBe(0);
    expect(leaf.radii[3]).toBe(0);
    expect(leaf.radii[1]).toBeGreaterThan(30);
    expect(leaf.radii[2]).toBeGreaterThan(30);
  });

  test('a hard edge stays hard', () => {
    const folded = { width: 678, height: 470 };
    const leaf = makeLeaf(halfPageBox(PAGE, folded, 'right'), folded, [0, 40, 40, 0], true, false);
    const back = makeLeaf(halfPageBox(PAGE, folded, 'left'), folded, [0, 40, 40, 0], true, true);
    expect(leaf.radii[1]).toBeGreaterThan(0);
    // Turned the other way, the leaf is the left page, whose outer corners are the hard edge's.
    expect(back.radii).toEqual([0, 0, 0, 0]);
  });

  test('mirroring swaps the sides', () => {
    expect(mirrorRadii([1, 2, 3, 4])).toEqual([2, 1, 4, 3]);
  });
});

describe('the leaf', () => {
  test("a spread's pages meet at the spine", () => {
    const left = halfPageBox(PAGE, DUO_OPEN, 'left');
    const right = halfPageBox(PAGE, DUO_OPEN, 'right');
    expect(left.x + left.width).toBeCloseTo(DUO_OPEN.width / 2, 6);
    expect(right.x).toBeCloseTo(DUO_OPEN.width / 2, 6);
  });

  test('turning back, the left page is the leaf, mirrored to the right of the spine', () => {
    const left = halfPageBox(PAGE, DUO_OPEN, 'left');
    const leaf = makeLeaf(left, DUO_OPEN, [44, 44, 44, 44], true, true);
    expect(leaf.spine).toBe(DUO_OPEN.width / 2);
    expect(leaf.box.x).toBe(DUO_OPEN.width / 2);
    expect(leaf.box.width).toBeCloseTo(left.width, 6);
  });

  test('a page resting magnified turns as the whole screen', () => {
    const spread = { width: 1600, height: 1107 };
    expect(singlePageBox(spread, PHONE, 'auto', false)).toEqual({ x: 0, y: 0, ...PHONE });
  });
});

describe('the curl', () => {
  const leaf: Leaf = makeLeaf(halfPageBox(PAGE, DUO_OPEN, 'right'), DUO_OPEN, [44, 44, 44, 44], true, false);
  const grabY = leaf.box.y + leaf.box.height * 0.8;

  test('lies flat with nothing pulled', () => {
    const edge = turnPull(leaf, grabY, 0);
    expect(curlFrame(leaf, grabY, edge.x, edge.y)).toBe(FLAT);
  });

  test('puts the fold between where the edge was and where it is', () => {
    const pull = turnPull(leaf, grabY, 0.4);
    const f = curlFrame(leaf, grabY, pull.x, pull.y);
    const grab = turnPull(leaf, grabY, 0);
    expect(sideOf(f, grab.x, grab.y)).toBeGreaterThan(0);
    expect(sideOf(f, pull.x, pull.y)).toBeLessThan(0);
    expect(f.r).toBeGreaterThan(0);
    expect(f.shade).toBeGreaterThan(0);
  });

  test('lands flat across the spine', () => {
    const end = landingPoint(leaf, grabY);
    const f = curlFrame(leaf, grabY, end.x, end.y);
    expect(f.r).toBeCloseTo(0, 6);
    expect(f.shade).toBeCloseTo(0, 6);
    expect(f.nx).toBeCloseTo(1, 6);
    expect(f.c).toBeCloseTo(leaf.spine, 6);
  });

  test('never lifts the spine, however far the finger goes', () => {
    for (const [x, y] of [
      [-2000, grabY],
      [leaf.spine, -3000],
      [leaf.spine - 100, 5000],
    ]) {
      const f = curlFrame(leaf, grabY, x!, y!);
      // The spine's ends stay on the flat side of the fold.
      expect(sideOf(f, leaf.spine, leaf.box.y)).toBeLessThanOrEqual(1e-6);
      expect(sideOf(f, leaf.spine, leaf.box.y + leaf.box.height)).toBeLessThanOrEqual(1e-6);
    }
  });

  test('progress runs from the flat leaf to the landed one', () => {
    expect(turnProgress(leaf, turnPull(leaf, grabY, 0).x)).toBe(0);
    expect(turnProgress(leaf, turnPull(leaf, grabY, 0.5).x)).toBeCloseTo(0.5, 6);
    expect(turnProgress(leaf, turnPull(leaf, grabY, 1).x)).toBe(1);
  });
});
