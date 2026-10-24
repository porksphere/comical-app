import { describe, expect, test } from 'bun:test';

import {
  buildSpreads,
  isStripPage,
  isWidePage,
  pageToSpreadPosition,
  readsDouble,
  lastPageOf,
  reportedPage,
  shapesPair,
  singleSpreads,
  spreadHalves,
  spreadImage,
  spreadPositions,
  type Size,
  type SpreadPage,
} from './spreads';

const chapter = (id: string, count: number): SpreadPage[] =>
  Array.from({ length: count }, (_, i) => ({ key: `${id}:${i}`, pageNumber: i + 1 }));

const groups = (pages: SpreadPage[], sizes: Record<string, Size> = {}, shift = false) =>
  buildSpreads(pages, (p) => sizes[p.key], shift).spreads.map((s) => s.pages.map((p) => p.key));

const wide = { width: 2000, height: 1400 };
const tall = { width: 1000, height: 1400 };
const strip = { width: 800, height: 12000 };

describe('isWidePage', () => {
  test('unknown counts as portrait', () => expect(isWidePage(undefined)).toBe(false));
  test('square is not wide', () => expect(isWidePage({ width: 10, height: 10 })).toBe(false));
  test('landscape is wide', () => expect(isWidePage(wide)).toBe(true));
});

describe('isStripPage', () => {
  test('unknown is not a strip', () => expect(isStripPage(undefined)).toBe(false));
  test('a page is not a strip', () => expect(isStripPage(tall)).toBe(false));
  test('three times taller than wide is', () => expect(isStripPage({ width: 800, height: 2401 })).toBe(true));
});

describe('buildSpreads', () => {
  test('the cover stands alone and the rest pair', () => {
    expect(groups(chapter('a', 6))).toEqual([['a:0'], ['a:1', 'a:2'], ['a:3', 'a:4'], ['a:5']]);
  });

  test('shift pairs from the first page', () => {
    expect(groups(chapter('a', 5), {}, true)).toEqual([['a:0', 'a:1'], ['a:2', 'a:3'], ['a:4']]);
  });

  test('a wide page stands alone and pairing restarts after it', () => {
    expect(groups(chapter('a', 7), { 'a:2': wide })).toEqual([
      ['a:0'],
      ['a:1'],
      ['a:2'],
      ['a:3', 'a:4'],
      ['a:5', 'a:6'],
    ]);
  });

  test('known portrait sizes pair like unknown ones', () => {
    expect(groups(chapter('a', 3), { 'a:1': tall, 'a:2': tall })).toEqual([['a:0'], ['a:1', 'a:2']]);
  });

  test('spreads never cross a chapter boundary', () => {
    expect(groups([...chapter('a', 4), ...chapter('b', 3)])).toEqual([
      ['a:0'],
      ['a:1', 'a:2'],
      ['a:3'],
      ['b:0'],
      ['b:1', 'b:2'],
    ]);
  });

  test('shift still stops at a chapter boundary', () => {
    expect(groups([...chapter('a', 3), ...chapter('b', 2)], {}, true)).toEqual([
      ['a:0', 'a:1'],
      ['a:2'],
      ['b:0', 'b:1'],
    ]);
  });

  test('spreadOf maps every page to its spread, keyed by the first page', () => {
    const layout = buildSpreads(chapter('a', 4), () => undefined, false);
    expect(layout.spreadOf).toEqual([0, 1, 1, 2]);
    expect(layout.spreads.map((s) => [s.key, s.first])).toEqual([
      ['a:0', 0],
      ['a:1', 1],
      ['a:3', 3],
    ]);
  });

  test('a page learning it is wide keeps the spread it opened', () => {
    const pages = chapter('a', 6);
    const before = buildSpreads(pages, () => undefined, false).spreads.map((s) => s.key);
    const after = buildSpreads(pages, (p) => (p.key === 'a:4' ? wide : undefined), false).spreads.map((s) => s.key);
    expect(before).toContain('a:3');
    expect(after).toContain('a:3');
  });

  test('empty', () => {
    expect(buildSpreads([], () => undefined, false)).toEqual({ spreads: [], spreadOf: [] });
  });

  test('pages of different shapes stand apart', () => {
    const credits = { width: 1000, height: 2000 };
    expect(groups(chapter('a', 6), { 'a:2': tall, 'a:3': credits, 'a:4': tall })).toEqual([
      ['a:0'],
      ['a:1', 'a:2'],
      ['a:3'],
      ['a:4', 'a:5'],
    ]);
  });

  test('a lone page sits at the spine: the cover after a blank, a cut-off page before one', () => {
    const { spreads } = buildSpreads(chapter('a', 8), (p) => (p.key === 'a:4' ? wide : undefined), false);
    expect(spreads.map((s) => s.pad)).toEqual(['before', undefined, 'after', undefined, undefined, 'after']);
  });

  test('a wide cover is not padded', () => {
    const { spreads } = buildSpreads(chapter('a', 3), (p) => (p.key === 'a:0' ? wide : undefined), false);
    expect(spreads[0]!.pad).toBeUndefined();
  });

  test('a chapter of two pages pairs them despite the cover rule', () => {
    expect(groups(chapter('a', 2))).toEqual([['a:0', 'a:1']]);
    expect(groups(chapter('a', 2), { 'a:0': tall, 'a:1': tall })).toEqual([['a:0', 'a:1']]);
    expect(groups([...chapter('a', 2), ...chapter('b', 3)])).toEqual([['a:0', 'a:1'], ['b:0'], ['b:1', 'b:2']]);
    expect(groups([...chapter('a', 3), ...chapter('b', 2)])).toEqual([['a:0'], ['a:1', 'a:2'], ['b:0', 'b:1']]);
  });

  test('two pages that would not pair anyway keep the cover rule', () => {
    const { spreads } = buildSpreads(chapter('a', 2), (p) => (p.key === 'a:1' ? wide : undefined), false);
    expect(spreads.map((s) => s.pages.map((p) => p.key))).toEqual([['a:0'], ['a:1']]);
    expect(spreads[0]!.pad).toBe('before');
    expect(groups(chapter('a', 2), { 'a:0': tall, 'a:1': { width: 1000, height: 2000 } })).toEqual([['a:0'], ['a:1']]);
  });

  test('strips never pair and are never padded', () => {
    const sizes = { 'a:0': strip, 'a:1': strip, 'a:2': strip, 'a:3': strip };
    const { spreads } = buildSpreads(chapter('a', 4), (p) => sizes[p.key as keyof typeof sizes], false);
    expect(spreads.map((s) => s.pages.map((p) => p.key))).toEqual([['a:0'], ['a:1'], ['a:2'], ['a:3']]);
    expect(spreads.map((s) => s.pad)).toEqual([undefined, undefined, undefined, undefined]);
  });

  test('a page before a strip stands alone and pairing restarts after it', () => {
    const { spreads } = buildSpreads(chapter('a', 5), (p) => (p.key === 'a:2' ? strip : undefined), false);
    expect(spreads.map((s) => s.pages.map((p) => p.key))).toEqual([['a:0'], ['a:1'], ['a:2'], ['a:3', 'a:4']]);
    expect(spreads.map((s) => s.pad)).toEqual(['before', 'after', undefined, undefined]);
  });

  test('a two-page chapter of strips stays two strips', () => {
    expect(groups(chapter('a', 2), { 'a:0': strip, 'a:1': strip })).toEqual([['a:0'], ['a:1']]);
  });
});

describe('shapesPair', () => {
  test('unknown pairs', () => expect(shapesPair(undefined, tall)).toBe(true));
  test('near shapes pair', () => expect(shapesPair(tall, { width: 1050, height: 1400 })).toBe(true));
  test('different shapes do not', () => expect(shapesPair(tall, { width: 1000, height: 2000 })).toBe(false));
});

describe('spreadHalves', () => {
  const [a, b] = chapter('a', 2);
  test('a pair is its pages', () => expect(spreadHalves({ pages: [a!, b!] })).toEqual([a, b]));
  test('padding puts a blank on the named side', () => {
    expect(spreadHalves({ pages: [a!], pad: 'before' })).toEqual([null, a]);
    expect(spreadHalves({ pages: [a!], pad: 'after' })).toEqual([a, null]);
  });
});

describe('spreadImage', () => {
  const viewport = { width: 1600, height: 1000 };
  test('a blank half measures as its page twin', () => {
    expect(spreadImage([undefined, tall], viewport)).toEqual(spreadImage([tall, tall], viewport));
  });
  test('null until the page loads', () => expect(spreadImage([undefined, null], viewport)).toBeNull());
});

describe('singleSpreads', () => {
  test('one page per spread', () => {
    const layout = singleSpreads(chapter('a', 3));
    expect(layout.spreads.map((s) => s.pages.length)).toEqual([1, 1, 1]);
    expect(layout.spreadOf).toEqual([0, 1, 2]);
  });
});

describe('reportedPage', () => {
  test('a pair reports its first page', () => {
    const pages = chapter('a', 5);
    const { spreads } = buildSpreads(pages, () => undefined, false); // [0] [1 2] [3 4]
    expect(spreads.map((s) => reportedPage(s, pages))).toEqual([0, 1, 4]);
  });

  test("a chapter's final spread reports its last page, mid-window too", () => {
    const pages = [...chapter('a', 3), ...chapter('b', 3)];
    const { spreads } = buildSpreads(pages, () => undefined, false); // [a0] [a1 a2] [b0] [b1 b2]
    expect(spreads.map((s) => reportedPage(s, pages))).toEqual([0, 2, 3, 5]);
    expect(spreads.map(lastPageOf)).toEqual([0, 2, 3, 5]);
  });
});

describe('spread positions', () => {
  const layout = buildSpreads(chapter('a', 4), () => undefined, false); // [0] [1 2] [3]
  const positions = spreadPositions(layout);

  test('each page of a pair covers half of it', () => {
    expect(positions).toEqual([0, 1, 1.5, 2, 3]);
  });

  test('whole pages land on their spreads', () => {
    expect(pageToSpreadPosition(positions, 0)).toBe(0);
    expect(pageToSpreadPosition(positions, 1)).toBe(1);
    expect(pageToSpreadPosition(positions, 2)).toBe(1.5);
    expect(pageToSpreadPosition(positions, 3)).toBe(2);
  });

  test('fractions interpolate and the ends clamp', () => {
    expect(pageToSpreadPosition(positions, 0.5)).toBe(0.5);
    expect(pageToSpreadPosition(positions, 1.5)).toBe(1.25);
    expect(pageToSpreadPosition(positions, -2)).toBe(0);
    expect(pageToSpreadPosition(positions, 99)).toBe(3);
  });

  test('a single-page layout is the identity', () => {
    const p = spreadPositions(singleSpreads(chapter('a', 3)));
    expect(pageToSpreadPosition(p, 1.25)).toBe(1.25);
  });
});

describe('readsDouble', () => {
  const landscape = { width: 1200, height: 800 };
  const portrait = { width: 400, height: 800 };
  test('auto follows the frame', () => {
    expect(readsDouble('auto', landscape)).toBe(true);
    expect(readsDouble('auto', portrait)).toBe(false);
  });
  test('explicit choices ignore it', () => {
    expect(readsDouble('double', portrait)).toBe(true);
    expect(readsDouble('single', landscape)).toBe(false);
  });
});
