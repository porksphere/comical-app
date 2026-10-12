import { describe, expect, test } from 'bun:test';

import { DEFAULT_THUMB_ASPECT, rowCoverAspect, rowCoverAspects } from './aspect-ratio';

describe('rowCoverAspect', () => {
  test('a row of known-wide covers is laid out at its tallest one', () => {
    expect(rowCoverAspect([{ coverAspect: 1.5 }, { coverAspect: 0.8 }, { coverAspect: 1.2 }])).toBe(0.8);
  });

  test('one card without a shape holds the row at 2:3', () => {
    expect(rowCoverAspect([{ coverAspect: 1.5 }, {}])).toBe(DEFAULT_THUMB_ASPECT);
  });

  test('a redacted placeholder holds the row at 2:3 whatever shape it carries', () => {
    expect(rowCoverAspect([{ coverAspect: 1.5 }, { coverAspect: 1.5, excluded: true }])).toBe(DEFAULT_THUMB_ASPECT);
  });

  test('a cover taller than 2:3 never makes the row taller than 2:3', () => {
    expect(rowCoverAspect([{ coverAspect: 0.4 }, { coverAspect: 1.5 }])).toBe(DEFAULT_THUMB_ASPECT);
  });

  test('unusable shapes count as unknown', () => {
    for (const coverAspect of [0, -1, NaN, Infinity]) expect(rowCoverAspect([{ coverAspect }])).toBe(DEFAULT_THUMB_ASPECT);
  });

  test('an empty row is 2:3', () => {
    expect(rowCoverAspect([])).toBe(DEFAULT_THUMB_ASPECT);
  });
});

describe('rowCoverAspects', () => {
  test('splits into numColumns-wide rows, the last one short', () => {
    const wide = { coverAspect: 1.5 };
    expect(rowCoverAspects([wide, wide, wide, {}, wide], 2)).toEqual([1.5, DEFAULT_THUMB_ASPECT, 1.5]);
  });

  test('no entries, no rows', () => {
    expect(rowCoverAspects([], 3)).toEqual([]);
  });
});
