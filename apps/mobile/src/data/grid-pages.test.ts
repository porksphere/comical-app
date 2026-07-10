import { describe, expect, test } from 'bun:test';

import { dedupPages } from './grid-pages';
import type { GridPage, SeriesEntry } from './types';

const entry = (id: string): SeriesEntry => ({ id, title: id, cover: '' });
const page = (...ids: string[]): GridPage => ({ items: ids.map(entry), hasNextPage: true });
const ids = (items: SeriesEntry[]) => items.map((e) => e.id);

describe('dedupPages', () => {
  test('removes duplicates within a single page, first occurrence wins', () => {
    const c = dedupPages(null, [page('a', 'b', 'a', 'c', 'b')]);
    expect(ids(c.out)).toEqual(['a', 'b', 'c']);
  });

  test('removes a series that reappears on the next page (the live-feed case)', () => {
    // Page 2 re-includes 'c' (bumped up the feed between fetches) plus new 'd','e'.
    const p1 = page('a', 'b', 'c');
    const c1 = dedupPages(null, [p1]);
    const c2 = dedupPages(c1, [p1, page('c', 'd', 'e')]);
    expect(ids(c2.out)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('incremental result matches a from-scratch flatten+dedup', () => {
    const p1 = page('a', 'b', 'c');
    const p2 = page('c', 'd', 'e'); // overlaps p1 on 'c'
    const p3 = page('e', 'f', 'a'); // overlaps on 'e' and 'a'
    let c = dedupPages(null, [p1]);
    c = dedupPages(c, [p1, p2]);
    c = dedupPages(c, [p1, p2, p3]);
    const scratch = Array.from(
      new Map([p1, p2, p3].flatMap((p) => p.items).map((e) => [e.id, e])).values(),
    );
    expect(ids(c.out)).toEqual(ids(scratch));
    expect(ids(c.out)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  test('same pages array → identical out reference (no downstream churn)', () => {
    const p1 = page('a', 'b');
    const c1 = dedupPages(null, [p1]);
    const c2 = dedupPages(c1, c1.pages); // same pages, re-render
    expect(c2.out).toBe(c1.out);
  });

  test('a fully-duplicate appended page keeps the SAME out reference', () => {
    const p1 = page('a', 'b', 'c');
    const c1 = dedupPages(null, [p1]);
    const c2 = dedupPages(c1, [p1, page('a', 'b')]); // all already seen
    expect(ids(c2.out)).toEqual(['a', 'b', 'c']);
    expect(c2.out).toBe(c1.out); // reference-stable
  });

  test('an append with new unique items yields a new out reference', () => {
    const p1 = page('a', 'b');
    const c1 = dedupPages(null, [p1]);
    const c2 = dedupPages(c1, [p1, page('c')]);
    expect(c2.out).not.toBe(c1.out);
    expect(ids(c2.out)).toEqual(['a', 'b', 'c']);
  });

  test('preserves original item object identity across appends', () => {
    const p1 = page('a', 'b');
    const c1 = dedupPages(null, [p1]);
    const first = c1.out[0];
    const c2 = dedupPages(c1, [p1, page('c')]);
    expect(c2.out[0]).toBe(first); // 'a' is the same object, not re-created
  });

  test('rebuilds from scratch when the pages prefix changes (pull-to-refresh)', () => {
    const c1 = dedupPages(null, [page('a', 'b', 'c')]);
    // A refresh replaces page 1 with a fresh (different-reference) page: no shared prefix.
    const fresh = page('x', 'y');
    const c2 = dedupPages(c1, [fresh]);
    expect(ids(c2.out)).toEqual(['x', 'y']);
    expect(c2.seen.has('a')).toBe(false); // stale seen-set was discarded
  });

  test('empty data → empty, stable', () => {
    const c = dedupPages(null, []);
    expect(c.out).toEqual([]);
  });
});
