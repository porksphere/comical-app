import { describe, expect, test } from 'bun:test';

import { buildCollectedRows, type CollectedRow } from './collected-rows';
import type { ApiCollectionChapterItem, ApiCollectionItem, ApiCollectionPageItem } from './api';

const page = (
  id: string,
  seriesId: string,
  collectedAt: number,
  seriesTitle = seriesId,
): ApiCollectionPageItem =>
  ({
    type: 'page',
    id,
    bridgeId: 'b',
    seriesId,
    chapterId: 'c',
    pageIndex: 0,
    collectedAt,
    collectionIds: ['coll'],
    seriesTitle,
  }) as ApiCollectionPageItem;

const chapter = (id: string, seriesId: string, collectedAt: number): ApiCollectionChapterItem =>
  ({
    type: 'chapter',
    id,
    bridgeId: 'b',
    seriesId,
    chapterId: `ch-${id}`,
    collectedAt,
    collectionIds: ['coll'],
    seriesTitle: seriesId,
  }) as ApiCollectionChapterItem;

const series = (id: string, seriesId: string, collectedAt: number): ApiCollectionItem =>
  ({
    type: 'series',
    id,
    bridgeId: 'b',
    seriesId,
    collectedAt,
    collectionIds: ['coll'],
    seriesTitle: seriesId,
  }) as ApiCollectionItem;

const labels = (rows: CollectedRow[]) => rows.filter((r) => r.type === 'header').map((r) => r.label);
const ids = (rows: CollectedRow[]) =>
  rows.flatMap((r) => (r.type === 'row' ? r.items.map((i) => i.id) : []));

// A fixed formatter keeps these independent of the machine's clock and locale.
const fmt = (ms: number) => `day-${ms}`;

describe('buildCollectedRows', () => {
  test('chunks into rows of numColumns', () => {
    const items = [page('1', 's', 1), page('2', 's', 2), page('3', 's', 3)];
    const rows = buildCollectedRows(items, 2, 'none', fmt);
    expect(rows.map((r) => r.type)).toEqual(['row', 'row']);
    expect(rows[0]!.type === 'row' && rows[0]!.items.length).toBe(2);
    expect(rows[1]!.type === 'row' && rows[1]!.items.length).toBe(1);
  });

  test('ungrouped keeps the server order exactly', () => {
    const items = [page('3', 'b', 3), page('1', 'a', 1), page('2', 'c', 2)];
    expect(ids(buildCollectedRows(items, 3, 'none', fmt))).toEqual(['3', '1', '2']);
  });

  // The whole point of bucketing in first-appearance order: grouping composes with the chosen sort
  // instead of silently re-sorting. Sorted newest-first and grouped by series, the series appear in
  // the order they were most recently added to.
  test('grouping by series preserves incoming order, within and between groups', () => {
    const items = [
      page('a1', 'alpha', 10),
      page('b1', 'beta', 9),
      page('a2', 'alpha', 8),
      page('b2', 'beta', 7),
    ];
    const rows = buildCollectedRows(items, 4, 'series', fmt);
    expect(labels(rows)).toEqual(['alpha', 'beta']);
    expect(ids(rows)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  test('a header carries its own count, not the total', () => {
    const items = [page('a1', 'alpha', 3), page('a2', 'alpha', 2), page('b1', 'beta', 1)];
    const rows = buildCollectedRows(items, 4, 'series', fmt);
    const headers = rows.filter((r) => r.type === 'header');
    expect(headers.map((h) => h.type === 'header' && h.count)).toEqual([2, 1]);
  });

  test('grouping by date buckets per calendar day, not per timestamp', () => {
    const day = new Date(2026, 0, 15, 9).getTime();
    const laterSameDay = new Date(2026, 0, 15, 22).getTime();
    const nextDay = new Date(2026, 0, 16, 1).getTime();
    const rows = buildCollectedRows(
      [page('1', 's', day), page('2', 's', laterSameDay), page('3', 's', nextDay)],
      4,
      'date',
      fmt,
    );
    expect(rows.filter((r) => r.type === 'header').length).toBe(2);
    expect(ids(rows)).toEqual(['1', '2', '3']);
  });

  // Rows recycle, so a row's key has to change when its contents do — an index-based key would
  // leave a reused row rendering the previous items.
  test('row keys are derived from their items', () => {
    const first = buildCollectedRows([page('1', 's', 1), page('2', 's', 2)], 2, 'none', fmt);
    const second = buildCollectedRows([page('9', 's', 1), page('2', 's', 2)], 2, 'none', fmt);
    expect(first[0]!.key).not.toBe(second[0]!.key);
  });

  // A collection holds all three types, and the runtime interleaves them (a series leads its
  // chapters, a chapter leads its pages). Re-bucketing by type here would throw that away.
  test('a chapter breaks the tile grid without reordering anything', () => {
    const rows = buildCollectedRows(
      [series('s1', 'alpha', 5), page('p1', 'alpha', 4), chapter('c1', 'alpha', 3), page('p2', 'alpha', 2)],
      4,
      'none',
      fmt,
    );
    expect(rows.map((r) => r.type)).toEqual(['row', 'chapter', 'row']);
    // The series and the first page share a tile row; the chapter interrupts; the last page follows.
    expect(rows[0]!.type === 'row' && rows[0]!.items.map((i) => i.id)).toEqual(['s1', 'p1']);
    expect(rows[2]!.type === 'row' && rows[2]!.items.map((i) => i.id)).toEqual(['p2']);
  });

  test('consecutive chapters each get their own row', () => {
    const rows = buildCollectedRows([chapter('c1', 'a', 2), chapter('c2', 'a', 1)], 3, 'none', fmt);
    expect(rows.map((r) => r.type)).toEqual(['chapter', 'chapter']);
  });

  test('empty input yields no rows, and a header is never emitted alone', () => {
    expect(buildCollectedRows([], 3, 'series', fmt)).toEqual([]);
    expect(buildCollectedRows([], 3, 'none', fmt)).toEqual([]);
  });
});
