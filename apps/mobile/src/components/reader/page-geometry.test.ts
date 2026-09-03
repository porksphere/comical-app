import { describe, expect, test } from 'bun:test';

import { containedSize, edgeOffset, effectiveFit, fillRule, pageGeometry, panLimits } from './page-geometry';

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
    const g = pageGeometry(spread, phone, 'all', false);
    expect(g.restScale).toBeCloseTo(844 / 195, 6);
    expect(g.restEdge).toBe('left');
    expect(edgeOffset(g.restEdge, panLimits(g.restScale, g.content, phone).x)).toBeGreaterThan(0);
  });
  test('and at the right edge for right-to-left', () => {
    expect(pageGeometry(spread, phone, 'all', true).restEdge).toBe('right');
  });
  test('a portrait page rests at 1× under no rule, however tall the phone', () => {
    const g = pageGeometry(portrait, phone, 'none', false);
    expect(g.restScale).toBe(1);
    expect(g.restEdge).toBe('center');
  });
  test('fit-height rests an ordinary page at the viewport height, at the reading edge', () => {
    const g = pageGeometry(portrait, phone, 'all', false);
    expect(g.restScale).toBeCloseTo(844 / (390 / 0.7), 6);
    expect(g.restEdge).toBe('left');
  });
  test('fit-height leaves a page near the screen shape whole', () => {
    // 5% taller than the viewport's aspect: within FILL_HEIGHT_MIN_GAIN, so no zoom for a
    // few points of sideways pan.
    const near = { width: 1000, height: Math.round((1000 * 844) / 390 / 1.05) };
    expect(pageGeometry(near, phone, 'all', false).restScale).toBe(1);
  });
  test('nothing rests zoomed under no rule', () => {
    expect(pageGeometry(spread, phone, 'none', false).restScale).toBe(1);
  });
  test('a spread that already stands the full height of a landscape screen rests at 1×', () => {
    const g = pageGeometry({ width: 1600, height: 1000 }, { width: 1200, height: 600 }, 'all', false);
    expect(g.restScale).toBe(1);
  });
  test('unknown dimensions fill the viewport', () => {
    expect(pageGeometry(null, phone, 'all', false)).toEqual({ content: phone, restScale: 1, restEdge: 'center' });
  });
});

describe('effectiveFit', () => {
  test('fit-width is its own layout', () => {
    expect(effectiveFit('fit-width')).toBe('fit-width');
  });
  test('fit-height is drawn as the contain layout, with the rest doing the fitting', () => {
    expect(effectiveFit('fit-height')).toBe('fit-page');
  });
});

describe('fillRule', () => {
  test('fit-height covers every page', () => {
    expect(fillRule('fit-height')).toBe('all');
  });
  test('fit-width covers nothing', () => {
    expect(fillRule('fit-width')).toBe('none');
  });
});
