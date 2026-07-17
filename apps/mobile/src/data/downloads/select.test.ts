/** Pure selection helpers behind the download sheet / chapter picker, plus the range-fill core. */
import { describe, expect, test } from 'bun:test';
import type { DownloadedChapter } from '@comical/downloads';

import { fillRange } from '@/components/multi-select/use-multi-select';
import type { Chapter } from '@/data/types';
import { fromHere, nextN, remaining, selectableGroups, toEnqueue, unread } from './select';

const ch = (id: string, number: number, over: Partial<Chapter> = {}): Chapter => ({
  id,
  name: `Ch ${number}`,
  date: number,
  number,
  ...over,
});

const dl = (chapterId: string, state: DownloadedChapter['state']): DownloadedChapter =>
  ({ bridgeId: 'b', seriesId: 's', chapterId, state, pageCount: 1, completedPages: 0, bytes: 0, addedAt: 0 }) as DownloadedChapter;

// 5 logical chapters; c3 has two scanlator versions sharing number 3.
const CHAPTERS = [
  ch('c1', 1, { read: true }),
  ch('c2', 2, { read: true }),
  ch('c3a', 3, { group: 'A' }),
  ch('c3b', 3, { group: 'B' }),
  ch('c4', 4),
  ch('c5', 5),
];

describe('selectableGroups', () => {
  test('groups versions, ascending reading order, with manifest coverage', () => {
    const sel = selectableGroups(CHAPTERS, [dl('c1', 'complete'), dl('c3b', 'downloading'), dl('c4', 'failed')]);
    expect(sel.map((s) => s.group.number)).toEqual([1, 2, 3, 4, 5]);
    expect(sel.map((s) => s.settled)).toEqual([true, false, true, false, false]); // failed is retryable
    expect(sel.map((s) => s.complete)).toEqual([true, false, false, false, false]);
    expect(sel.map((s) => s.unread)).toEqual([false, false, true, true, true]);
  });
});

describe('selection options', () => {
  const sel = selectableGroups(CHAPTERS, [dl('c1', 'complete'), dl('c2', 'queued')]);

  test('remaining excludes complete and queued', () => {
    expect(remaining(sel).map((g) => g.number)).toEqual([3, 4, 5]);
  });

  test('unread excludes read chapters; nextN takes from the reading position', () => {
    expect(unread(sel).map((g) => g.number)).toEqual([3, 4, 5]);
    expect(nextN(sel, 2).map((g) => g.number)).toEqual([3, 4]);
  });

  test('fromHere spans the anchor through the end, skipping settled', () => {
    const withMid = selectableGroups(CHAPTERS, [dl('c4', 'complete')]);
    expect(fromHere(withMid, 'c3a').map((g) => g.number)).toEqual([3, 5]);
    expect(fromHere(withMid, 'nope')).toEqual([]);
  });

  test('toEnqueue resolves the preferred scanlator version', () => {
    const three = selectableGroups(CHAPTERS, []).filter((s) => s.group.number === 3);
    expect(toEnqueue(three.map((s) => s.group), 'B')[0]?.id).toBe('c3b');
    expect(toEnqueue(three.map((s) => s.group))[0]?.id).toBe('c3a'); // no preference → first/freshest
  });
});

describe('fillRange', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];

  test('selects the span between anchor and target, either direction', () => {
    expect([...fillRange(keys, 'b', 'd', new Set(['b']))]).toEqual(['b', 'c', 'd']);
    expect([...fillRange(keys, 'd', 'b', new Set(['d']))].sort()).toEqual(['b', 'c', 'd']);
  });

  test('adds to an existing selection and tolerates unknown keys', () => {
    expect([...fillRange(keys, 'a', 'b', new Set(['e']))].sort()).toEqual(['a', 'b', 'e']);
    expect([...fillRange(keys, 'zz', 'c', new Set())]).toEqual(['c']);
  });
});
