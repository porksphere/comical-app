import { beforeEach, describe, expect, test } from 'bun:test';

import {
  mockCollectPage,
  mockGetChapterPageIndices,
  mockGetCollectedItems,
  mockSetPageCollections,
  mockUncollectPage,
} from './mock';

// These lock the two runtime behaviours the client actively depends on, in the implementation the
// dev toggle, the GitHub Pages demo build and every e2e flow actually run against. Getting either
// wrong in the mock hides a real bug behind a green suite.
const B = 'bridge';
const S = 'series-1';
const C = 'chapter-1';
const snap = { seriesTitle: 'A Title' };

async function reset() {
  for (const i of await mockGetChapterPageIndices(B, S, C)) await mockUncollectPage(B, S, C, i);
}

describe('mock collected pages', () => {
  beforeEach(reset);

  test('collecting a page reports its index for the chapter', async () => {
    await mockCollectPage(B, S, C, 3, snap);
    expect(await mockGetChapterPageIndices(B, S, C)).toEqual([3]);
  });

  test('indices come back sorted regardless of collect order', async () => {
    await mockCollectPage(B, S, C, 7, snap);
    await mockCollectPage(B, S, C, 2, snap);
    expect(await mockGetChapterPageIndices(B, S, C)).toEqual([2, 7]);
  });

  test('a chapter only reports its own pages', async () => {
    await mockCollectPage(B, S, C, 1, snap);
    await mockCollectPage(B, S, 'chapter-2', 9, snap);
    expect(await mockGetChapterPageIndices(B, S, C)).toEqual([1]);
    await mockUncollectPage(B, S, 'chapter-2', 9);
  });

  // The two-PUT hash flow: collect on tap, then PUT again with only the hash once it resolves.
  // A rebuild-from-snapshot would silently drop `pageCount` here — reconcile's fallback re-anchor
  // signal — so the follow-up would trade a strong signal for the loss of the weak one.
  test('a partial re-collect MERGES rather than rebuilding', async () => {
    await mockCollectPage(B, S, C, 4, { seriesTitle: 'A Title', chapterName: 'Ch. 1', pageCount: 20 });
    await mockCollectPage(B, S, C, 4, { seriesTitle: 'A Title', contentHash: 'abc123' });

    const [item] = await mockGetCollectedItems({ type: 'page' });
    expect(item?.contentHash).toBe('abc123');
    expect(item?.pageCount).toBe(20);
    expect(item?.chapterName).toBe('Ch. 1');
  });

  test('re-collecting keeps the original collectedAt and memberships', async () => {
    await mockCollectPage(B, S, C, 5, snap);
    await mockSetPageCollections(B, S, C, 5, ['coll-x']);
    const [before] = await mockGetCollectedItems({ type: 'page' });

    await mockCollectPage(B, S, C, 5, { seriesTitle: 'Renamed' });
    const [after] = await mockGetCollectedItems({ type: 'page' });

    expect(after?.collectedAt).toBe(before!.collectedAt);
    expect(after?.collectionIds).toEqual(['coll-x']);
    expect(after?.seriesTitle).toBe('Renamed'); // a SUPPLIED field still wins as the fresher value
  });

  // Pure collections: an item exists only as a member, so emptying memberships is a removal —
  // not a "filed nowhere" state. The reader's heart depends on this to go hollow.
  test('emptying memberships removes the item', async () => {
    await mockCollectPage(B, S, C, 6, snap);
    await mockSetPageCollections(B, S, C, 6, ['coll-x']);
    expect(await mockGetChapterPageIndices(B, S, C)).toEqual([6]);

    await mockSetPageCollections(B, S, C, 6, []);
    expect(await mockGetChapterPageIndices(B, S, C)).toEqual([]);
    expect(await mockGetCollectedItems({ type: 'page' })).toEqual([]);
  });

  // Omitting `type` returns the mixed union — a page grid that forgets it renders series and
  // chapter items too, and the failure is silent.
  test('a series/chapter type filter excludes page items', async () => {
    await mockCollectPage(B, S, C, 8, snap);
    expect(await mockGetCollectedItems({ type: 'series' })).toEqual([]);
    expect((await mockGetCollectedItems({ type: 'page' })).length).toBe(1);
  });
});
