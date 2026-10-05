import { describe, expect, test } from 'bun:test';

import { mirrorGridRows } from './grid-rows';

const mirror = (count: number, cols: number) =>
  mirrorGridRows(
    Array.from({ length: count }, (_, i) => i),
    cols,
    () => -1,
  );

describe('mirrorGridRows', () => {
  test('reverses each full row and keeps the rows in order', () => {
    expect(mirror(6, 3)).toEqual([2, 1, 0, 5, 4, 3]);
  });

  test('pads a short last row at its start, so it sits against the right edge', () => {
    expect(mirror(5, 3)).toEqual([2, 1, 0, -1, 4, 3]);
    expect(mirror(1, 5)).toEqual([-1, -1, -1, -1, 0]);
  });

  test('every cell lands in the column mirrored from its own', () => {
    const cols = 5;
    const out = mirror(13, cols);
    for (let page = 0; page < 13; page++) {
      const at = out.indexOf(page);
      expect(Math.floor(at / cols)).toBe(Math.floor(page / cols));
      expect(at % cols).toBe(cols - 1 - (page % cols));
    }
  });

  test('nothing in is nothing out, and a single column is unchanged', () => {
    expect(mirror(0, 4)).toEqual([]);
    expect(mirror(3, 1)).toEqual([0, 1, 2]);
  });
});
