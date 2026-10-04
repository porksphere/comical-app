import { describe, expect, test } from 'bun:test';

import { feedCounts } from './feed-counts';

describe('feedCounts', () => {
  const res = { newChapters: 6, behind: { joined: 1, unseen: 3 } };

  test('caught-up only: unseen chapters are not shown, and joined ones are not announced', () => {
    expect(feedCounts(res, true)).toEqual({ shown: 3, announced: 2 });
  });

  test('with the rule off, every new chapter is shown and announced', () => {
    expect(feedCounts(res, false)).toEqual({ shown: 6, announced: 6 });
  });

  test('a server that reports no standing is one whose feed holds everything', () => {
    expect(feedCounts({ newChapters: 4 }, true)).toEqual({ shown: 4, announced: 4 });
  });

  test('a check that found only chapters of series the reader is behind on announces nothing', () => {
    expect(feedCounts({ newChapters: 2, behind: { joined: 0, unseen: 2 } }, true)).toEqual({ shown: 0, announced: 0 });
    expect(feedCounts({ newChapters: 1, behind: { joined: 1, unseen: 0 } }, true)).toEqual({ shown: 1, announced: 0 });
  });
});
