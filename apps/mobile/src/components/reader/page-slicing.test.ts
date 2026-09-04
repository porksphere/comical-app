import { describe, expect, test } from 'bun:test';

import { MAX_DRAWABLE_PX, sliceBands, sliceCount, sliceRects } from './page-slicing';

// Real measurements, from a survey of the most-followed Long Strip titles on MangaDex.
const strip10k = { width: 800, height: 10000 }; // the platform's upload ceiling; 6 of 13 titles hit it
const stripMedian = { width: 760, height: 5508 };
const shortSlice = { width: 800, height: 1280 }; // what WEBTOON itself slices everything down to
const page = { width: 1500, height: 2133 };
const spread = { width: 3000, height: 2133 };
const tallSpread = { width: 4000, height: 6000 }; // huge, but not a strip — must stay whole

describe('sliceCount', () => {
  test('leaves an ordinary page and a spread alone', () => {
    expect(sliceCount(page)).toBe(1);
    expect(sliceCount(spread)).toBe(1);
  });
  test('leaves a page that is big but not strip-shaped alone', () => {
    expect(sliceCount(tallSpread)).toBe(1);
  });
  test("leaves a short webtoon slice alone — it's already drawable", () => {
    expect(sliceCount(shortSlice)).toBe(1);
  });
  test('cuts a strip only once it is past what can be drawn', () => {
    expect(sliceCount({ width: 800, height: MAX_DRAWABLE_PX })).toBe(1);
    expect(sliceCount({ width: 800, height: MAX_DRAWABLE_PX + 1 })).toBe(2);
  });
  test('real strips', () => {
    expect(sliceCount(stripMedian)).toBe(2);
    expect(sliceCount(strip10k)).toBe(3);
  });
  test('degenerate sizes are left alone rather than divided by zero', () => {
    expect(sliceCount({ width: 0, height: 0 })).toBe(1);
    expect(sliceCount({ width: 800, height: 0 })).toBe(1);
  });
});

describe('sliceRects', () => {
  test('an unsliced picture is one rect covering the whole thing', () => {
    expect(sliceRects(page)).toEqual([{ originX: 0, originY: 0, width: 1500, height: 2133 }]);
  });
  test('slices tile the source exactly — no dropped row, no doubled row', () => {
    for (const image of [strip10k, stripMedian, { width: 720, height: 9883 }, { width: 1099, height: 9869 }]) {
      const rects = sliceRects(image);
      expect(rects[0].originY).toBe(0);
      let y = 0;
      for (const r of rects) {
        expect(r.originY).toBe(y); // starts where the previous one ended
        expect(r.originX).toBe(0);
        expect(r.width).toBe(image.width);
        y += r.height;
      }
      expect(y).toBe(image.height); // and together they are the whole picture
    }
  });
  test('every slice is drawable', () => {
    for (const r of sliceRects(strip10k)) expect(r.height).toBeLessThanOrEqual(MAX_DRAWABLE_PX);
  });
  test('slices are equal to within a pixel — no short offcut at the end', () => {
    const heights = sliceRects(strip10k).map((r) => r.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  });
});

describe('sliceBands', () => {
  test('bands sum to the box exactly, so no backdrop shows between them', () => {
    for (const [boxHeight, count] of [[5433, 3], [1000, 3], [999, 2], [7, 3]] as const) {
      const bands = sliceBands(boxHeight, count);
      expect(bands).toHaveLength(count);
      expect(bands.reduce((a, b) => a + b, 0)).toBe(boxHeight);
    }
  });
  test('bands are whole numbers', () => {
    for (const b of sliceBands(5433, 3)) expect(Number.isInteger(b)).toBe(true);
  });
  test('bands follow the same split as the source rects', () => {
    const rects = sliceRects(strip10k);
    const bands = sliceBands(4000, rects.length);
    // Each band is the same fraction of the box that its rect is of the source, within a pixel.
    rects.forEach((r, i) => {
      expect(Math.abs(bands[i] - (r.height / strip10k.height) * 4000)).toBeLessThanOrEqual(1);
    });
  });
});
