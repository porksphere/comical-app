import { describe, expect, test } from 'bun:test';

import type { LibraryGridItem } from './library-card';
import { libraryGroupOf } from './library-grouping';

const card = (over: Partial<LibraryGridItem>): LibraryGridItem => ({
  id: 's1',
  title: 'Series',
  cover: '',
  bridgeId: 'panelfox',
  bridge: 'PanelFox',
  ...over,
});

// A fixed formatter keeps these independent of the machine's clock and locale.
const fmt = (ms: number) => `day-${ms}`;

describe('libraryGroupOf', () => {
  test("'none' is no grouping at all — the grid takes its ungrouped path", () => {
    expect(libraryGroupOf('none')).toBeNull();
  });

  test('bridge groups by id and labels with the display name', () => {
    const groupOf = libraryGroupOf('bridge', fmt)!;
    expect(groupOf(card({}))).toEqual({ key: 'panelfox', label: 'PanelFox' });
  });

  test('an uninstalled bridge keeps its entries grouped under the raw id', () => {
    const groupOf = libraryGroupOf('bridge', fmt)!;
    expect(groupOf(card({ bridge: undefined }))).toEqual({ key: 'panelfox', label: 'panelfox' });
  });

  test('added buckets per calendar day, same day → same bucket', () => {
    const groupOf = libraryGroupOf('added', fmt)!;
    const morning = new Date(2026, 0, 15, 9).getTime();
    const evening = new Date(2026, 0, 15, 22).getTime();
    expect(groupOf(card({ collectedAt: morning })).key).toBe(groupOf(card({ collectedAt: evening })).key);
    expect(groupOf(card({ collectedAt: morning })).label).toBe(fmt(morning));
  });

  test('lastRead: a never-opened series lands in its own real bucket', () => {
    const groupOf = libraryGroupOf('lastRead', fmt)!;
    expect(groupOf(card({}))).toEqual({ key: 'never', label: 'Not read yet' });
    const read = new Date(2026, 0, 15, 9).getTime();
    expect(groupOf(card({ lastReadAt: read })).label).toBe(fmt(read));
  });
});
