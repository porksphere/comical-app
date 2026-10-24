import { describe, expect, test } from 'bun:test';

import { DETECT_MIN_PAGES, looksLikeWebtoon } from './webtoon-detection';

const page = { width: 1000, height: 1400 };
const phoneScan = { width: 1200, height: 1800 };
const spread = { width: 2000, height: 1400 };
const strip = { width: 800, height: 12000 };
const slice = { width: 720, height: 2200 };
const officialSlice = { width: 800, height: 1280 };
const credits = { width: 1000, height: 2000 };

const times = (size: typeof page, n: number) => Array.from({ length: n }, () => size);

describe('looksLikeWebtoon', () => {
  test('needs enough pages', () => {
    expect(looksLikeWebtoon(times(strip, DETECT_MIN_PAGES - 1))).toBe(false);
    expect(looksLikeWebtoon(times(strip, DETECT_MIN_PAGES))).toBe(true);
  });
  test('stitched strips', () => expect(looksLikeWebtoon(times(strip, 4))).toBe(true));
  test('phone-sized slices', () => expect(looksLikeWebtoon(times(slice, 5))).toBe(true));
  test('a cover ahead of strips does not hide them', () => {
    expect(looksLikeWebtoon([page, strip, strip])).toBe(true);
  });
  test('manga pages', () => expect(looksLikeWebtoon(times(page, 6))).toBe(false));
  test('large manga scans', () => expect(looksLikeWebtoon(times(phoneScan, 6))).toBe(false));
  test('manga with spreads', () => expect(looksLikeWebtoon([page, spread, page, page, spread])).toBe(false));
  test('one tall credits page does not make a webtoon', () => {
    expect(looksLikeWebtoon([page, page, page, credits, page])).toBe(false);
  });
  test('official 800x1280 slices are page-shaped and are not told apart', () => {
    expect(looksLikeWebtoon(times(officialSlice, 6))).toBe(false);
  });
  test('ignores sizes that are not sizes', () => {
    expect(looksLikeWebtoon([{ width: 0, height: 0 }, strip, strip])).toBe(false);
  });
});
