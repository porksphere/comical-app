import { describe, expect, test } from 'bun:test';

import { containedSize, edgeOffset, effectiveFit, pageGeometry, panLimits } from './page-geometry';

const phone = { width: 390, height: 844 };
const spread = { width: 2000, height: 1000 };
const portrait = { width: 700, height: 1000 };

describe('containedSize', () => {
  test('a spread on a phone is width-limited', () => {
    expect(containedSize(spread, phone)).toEqual({ width: 390, height: 195 });
  });
  test('a portrait page on a phone is width-limited too', () => {
    const c = containedSize(portrait, phone);
    expect(c.width).toBe(390);
    expect(c.height).toBeCloseTo(557.14, 1);
  });
});

describe('panLimits', () => {
  test('nothing to pan at 1× when the content fits', () => {
    expect(panLimits(1, { width: 390, height: 195 }, phone)).toEqual({ x: 0, y: 0 });
  });
  test('a spread at fit-height pans sideways only', () => {
    const content = containedSize(spread, phone);
    const scale = phone.height / content.height;
    const limit = panLimits(scale, content, phone);
    expect(limit.y).toBeCloseTo(0, 6);
    expect(limit.x).toBeCloseTo((1688 - 390) / 2, 6);
  });
  test('a zoomed portrait page cannot be pushed into its letterbox', () => {
    const content = containedSize(portrait, phone);
    const limit = panLimits(2.5, content, phone);
    // 2.5 × 557 = 1393 tall: the overhang past 844 is what may be panned, not (2.5 − 1) × 844 / 2.
    expect(limit.y).toBeCloseTo((2.5 * content.height - 844) / 2, 6);
    expect(limit.y).toBeLessThan(((2.5 - 1) * 844) / 2);
  });
});

describe('pageGeometry', () => {
  test('a spread rests at fit-height, at the left edge for left-to-right', () => {
    const g = pageGeometry(spread, phone, true, false);
    expect(g.restScale).toBeCloseTo(844 / 195, 6);
    expect(g.restEdge).toBe('left');
    expect(edgeOffset(g.restEdge, panLimits(g.restScale, g.content, phone).x)).toBeGreaterThan(0);
  });
  test('and at the right edge for right-to-left', () => {
    expect(pageGeometry(spread, phone, true, true).restEdge).toBe('right');
  });
  test('a portrait page rests at 1× however tall the phone', () => {
    const g = pageGeometry(portrait, phone, true, false);
    expect(g.restScale).toBe(1);
    expect(g.restEdge).toBe('center');
  });
  test('the spread rule is a setting', () => {
    expect(pageGeometry(spread, phone, false, false).restScale).toBe(1);
  });
  test('a spread that already stands the full height of a landscape screen rests at 1×', () => {
    const g = pageGeometry({ width: 1600, height: 1000 }, { width: 1200, height: 600 }, true, false);
    expect(g.restScale).toBe(1);
  });
  test('unknown dimensions fill the viewport', () => {
    expect(pageGeometry(null, phone, true, false)).toEqual({ content: phone, restScale: 1, restEdge: 'center' });
  });
});

describe('effectiveFit', () => {
  test('a fixed fit is itself', () => {
    expect(effectiveFit('fit-page', spread)).toBe('fit-page');
    expect(effectiveFit('fit-width', spread)).toBe('fit-width');
  });
  test('smart is fit-width for a tall page and fit-page for a spread', () => {
    expect(effectiveFit('smart', portrait)).toBe('fit-width');
    expect(effectiveFit('smart', spread)).toBe('fit-page');
  });
  test('smart assumes tall until the picture says otherwise', () => {
    expect(effectiveFit('smart', null)).toBe('fit-width');
  });
});
