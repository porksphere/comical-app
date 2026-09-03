import { describe, expect, test } from 'bun:test';

import { containedSize, edgeOffset, pageLayout, panLimits } from './page-geometry';

const phone = { width: 390, height: 844 };
const tablet = { width: 1200, height: 600 };
const spread = { width: 2000, height: 1000 };
const portrait = { width: 700, height: 1000 };
const strip = { width: 800, height: 8000 };

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
  test('nothing to pan when the box fits', () => {
    expect(panLimits(1, { width: 390, height: 195 }, phone)).toEqual({ x: 0, y: 0 });
  });
  test('a fit-height box pans sideways only', () => {
    const limit = panLimits(1, { width: 1688, height: 844 }, phone);
    expect(limit.y).toBe(0);
    expect(limit.x).toBeCloseTo((1688 - 390) / 2, 6);
  });
  test('a magnified box cannot be pushed past its own edge', () => {
    const box = containedSize(portrait, phone);
    const limit = panLimits(2.5, box, phone);
    expect(limit.y).toBeCloseTo((2.5 * box.height - 844) / 2, 6);
    expect(limit.y).toBeLessThan(((2.5 - 1) * 844) / 2);
  });
});

describe('edgeOffset', () => {
  test('brings the named edge to the viewport', () => {
    expect(edgeOffset('left', { x: 100, y: 0 })).toEqual({ x: 100, y: 0 });
    expect(edgeOffset('right', { x: 100, y: 0 })).toEqual({ x: -100, y: 0 });
    expect(edgeOffset('top', { x: 0, y: 300 })).toEqual({ x: 0, y: 300 });
    expect(edgeOffset('center', { x: 100, y: 300 })).toEqual({ x: 0, y: 0 });
  });
});

describe('pageLayout under fit-width', () => {
  test('an ordinary page on a phone fits whole, centred', () => {
    const l = pageLayout(portrait, phone, 'fit-width', true, false);
    expect(l.box.width).toBe(390);
    expect(l.edge).toBe('center');
  });
  test('a strip fills the width and starts at the top', () => {
    const l = pageLayout(strip, phone, 'fit-width', true, false);
    expect(l.box).toEqual({ width: 390, height: 3900 });
    expect(l.edge).toBe('top');
  });
  test('a spread fits the height under the spread rule, at the reading edge', () => {
    const l = pageLayout(spread, phone, 'fit-width', true, false);
    expect(l.box).toEqual({ width: 1688, height: 844 });
    expect(l.edge).toBe('left');
    expect(pageLayout(spread, phone, 'fit-width', true, true).edge).toBe('right');
  });
  test('and lies as a strip without it', () => {
    const l = pageLayout(spread, phone, 'fit-width', false, false);
    expect(l.box).toEqual({ width: 390, height: 195 });
    expect(l.edge).toBe('center');
  });
  test('a page within the tolerance of the screen shape fits whole on a tablet', () => {
    // 0.7 on a 0.75 screen: fit-width would overflow the height by 7%, under FIT_MIN_GAIN.
    const l = pageLayout(portrait, { width: 750, height: 1000 }, 'fit-width', true, false);
    expect(l.edge).toBe('center');
    expect(l.box.height).toBe(1000);
  });
});

describe('pageLayout under fit-height', () => {
  test('an ordinary page on a phone fills the height and starts at the reading edge', () => {
    const l = pageLayout(portrait, phone, 'fit-height', true, false);
    expect(l.box.height).toBe(844);
    expect(l.box.width).toBeCloseTo(844 * 0.7, 6);
    expect(l.edge).toBe('left');
  });
  test('a strip fits whole', () => {
    const l = pageLayout(strip, phone, 'fit-height', true, false);
    expect(l.box.height).toBe(844);
    expect(l.edge).toBe('center');
  });
  test('an ordinary page on a landscape tablet fits whole', () => {
    expect(pageLayout(portrait, tablet, 'fit-height', true, false).edge).toBe('center');
  });
  test('a spread that already stands the full height rests as it is', () => {
    const l = pageLayout({ width: 1600, height: 1000 }, tablet, 'fit-height', true, false);
    expect(l.edge).toBe('center');
  });
});

describe('pageLayout stand-ins', () => {
  test('contain fits both axes whatever the setting', () => {
    expect(pageLayout(portrait, phone, 'contain', true, false).edge).toBe('center');
  });
  test('unknown dimensions fill the viewport', () => {
    expect(pageLayout(null, phone, 'fit-height', true, false)).toEqual({ box: phone, edge: 'center' });
  });
});
