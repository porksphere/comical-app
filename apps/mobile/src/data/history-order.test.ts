import { describe, expect, it } from 'bun:test';

import { historyWithBumped } from './history-order';
import type { HistoryEntry } from './types';

const entry = (seriesId: string, lastReadAt: number): HistoryEntry => ({
  bridgeId: 'b',
  seriesId,
  title: seriesId.toUpperCase(),
  lastReadAt,
});

const NOW = 1_000_000;

describe('historyWithBumped', () => {
  it('moves a read series to the front and stamps it', () => {
    const cur = [entry('a', 30), entry('b', 20), entry('c', 10)];
    const next = historyWithBumped(cur, { bridgeId: 'b', seriesId: 'c', title: 'C' }, NOW)!;
    expect(next.map((h) => h.seriesId)).toEqual(['c', 'a', 'b']);
    expect(next[0]!.lastReadAt).toBe(NOW);
  });

  it('leaves the array alone when the series is already at the front', () => {
    const cur = [entry('a', 30), entry('b', 20)];
    // Same REFERENCE, not merely equal — this is what stops a long read re-rendering a covered list.
    expect(historyWithBumped(cur, { bridgeId: 'b', seriesId: 'a', title: 'A' }, NOW)).toBe(cur);
  });

  it('inserts a series that is not in the list yet', () => {
    const cur = [entry('a', 30)];
    const next = historyWithBumped(cur, { bridgeId: 'b', seriesId: 'z', title: 'Z' }, NOW)!;
    expect(next.map((h) => h.seriesId)).toEqual(['z', 'a']);
    expect(next[0]!.title).toBe('Z');
  });

  it('keeps fields the bump does not carry, and overwrites the ones it does', () => {
    const cur = [entry('a', 30), { ...entry('c', 10), thumbnailUrl: 'keep.png', pageCount: 40 }];
    const next = historyWithBumped(cur, { bridgeId: 'b', seriesId: 'c', title: 'C', lastPage: 7 }, NOW)!;
    expect(next[0]).toMatchObject({ seriesId: 'c', thumbnailUrl: 'keep.png', pageCount: 40, lastPage: 7 });
  });

  it('passes an unloaded cache straight through', () => {
    expect(historyWithBumped(undefined, { bridgeId: 'b', seriesId: 'a', title: 'A' }, NOW)).toBeUndefined();
  });

  it('matches on bridge as well as series, so the same id on another bridge is a different row', () => {
    const cur = [entry('a', 30), { ...entry('c', 10), bridgeId: 'other' }];
    const next = historyWithBumped(cur, { bridgeId: 'b', seriesId: 'c', title: 'C' }, NOW)!;
    expect(next.map((h) => `${h.bridgeId}:${h.seriesId}`)).toEqual(['b:c', 'b:a', 'other:c']);
  });
});
