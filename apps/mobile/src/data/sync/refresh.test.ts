import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { refreshAfterSync } from './refresh';

const KEYS = [
  ['bridgeFeaturedRail', 'bridge-a'],
  ['chapterPages', 'bridge-a', 's1', 'c1'],
  ['seriesDetail', 'bridge-a', 's1'],
  ['activity'],
  ['chapterProgress', 'bridge-a', 's1'],
  ['library'],
  ['someKeyAddedLater'],
];

function invalidatedAfter(tables: readonly string[] | undefined): string[] {
  const client = new QueryClient();
  for (const key of KEYS) client.setQueryData(key, 1);
  refreshAfterSync(client, tables);
  return client
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => q.queryKey[0] as string);
}

describe('refreshAfterSync', () => {
  test('a library-only round leaves bridge content alone and refreshes the rest', () => {
    expect(invalidatedAfter(['activity', 'progress'])).toEqual(['activity', 'chapterProgress', 'library', 'someKeyAddedLater']);
  });

  test('a round that touched bridges or their settings refreshes everything', () => {
    expect(invalidatedAfter(['progress', 'bridgeSettings'])).toHaveLength(KEYS.length);
    expect(invalidatedAfter(['installed'])).toHaveLength(KEYS.length);
  });

  test("a hub that doesn't name its tables refreshes everything", () => {
    expect(invalidatedAfter(undefined)).toHaveLength(KEYS.length);
  });
});
