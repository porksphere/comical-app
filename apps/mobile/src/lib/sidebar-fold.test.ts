import { describe, expect, test } from 'bun:test';

import { foldSidebarRows, SIDEBAR_FOLD_AT } from './sidebar-fold';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('foldSidebarRows', () => {
  test('a group that fits shows every row and has no More row', () => {
    expect(foldSidebarRows(rows(3), 0, false)).toEqual({ rows: rows(3), hidden: 0 });
    expect(foldSidebarRows(rows(SIDEBAR_FOLD_AT), 0, false).hidden).toBe(0);
  });

  test('one row over the limit is shown rather than folded alone', () => {
    const fold = foldSidebarRows(rows(SIDEBAR_FOLD_AT + 1), 0, false);
    expect(fold).toEqual({ rows: rows(SIDEBAR_FOLD_AT + 1), hidden: 0 });
  });

  test('a longer group shows the first rows and counts the rest', () => {
    const fold = foldSidebarRows(rows(10), 0, false);
    expect(fold.rows).toEqual(rows(SIDEBAR_FOLD_AT));
    expect(fold.hidden).toBe(10 - SIDEBAR_FOLD_AT);
  });

  test('open, every row shows and the count stays for the row that folds them again', () => {
    expect(foldSidebarRows(rows(10), 0, true)).toEqual({ rows: rows(10), hidden: 10 - SIDEBAR_FOLD_AT });
  });

  test('a selected row past the fold takes the last shown place', () => {
    const fold = foldSidebarRows(rows(10), 8, false);
    expect(fold.rows).toEqual([...rows(SIDEBAR_FOLD_AT - 1), 8]);
    expect(fold.rows).toHaveLength(SIDEBAR_FOLD_AT);
  });

  test('no selection folds as the first rows', () => {
    expect(foldSidebarRows(rows(10), -1, false).rows).toEqual(rows(SIDEBAR_FOLD_AT));
  });
});
