/**
 * How live download events land in the query caches (`events.ts`). The parsing side is pinned in
 * `engine.test.ts`; what's pinned here is the CACHE contract, driven through the real embedded
 * subscription and a real `QueryClient`:
 *
 *  - a page event for a chapter the cached storage tree already knows about patches that chapter's
 *    progress in place (no refetch — this is what makes the radials tick);
 *  - a page event for a chapter the tree does NOT know about writes nothing, so the invalidation the
 *    enqueue left behind survives and the screen refetches when it mounts. Writing "the same tree
 *    back" instead used to clear that invalidation (`setQueryData` also restamps freshness), which
 *    is how a freshly enqueued series stayed missing from the Downloads screen: a chaptered series
 *    was rescued by its first chapter COMPLETING (that event invalidates), but a direct series is a
 *    single chapter — nothing invalidated until the whole download finished, so it only showed up
 *    once done.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import type { DownloadEngineEvent, StorageUsage } from '@comical/downloads';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } } });

let emit: ((e: DownloadEngineEvent) => void) | undefined;

mock.module('../query-client', () => ({ queryClient }));
mock.module('../queries', () => ({
  queryKeys: {
    downloadsUsage: () => ['downloads', 'usage'] as const,
    seriesDownloads: (b: string, s: string) => ['downloads', 'series', b, s] as const,
  },
}));
mock.module('../embedded/preference', () => ({ getResolvedModeSync: () => 'embedded' }));
mock.module('@comical/host-rn', () => ({
  getEmbeddedDownloadEngine: () => ({
    subscribe: (fn: (e: DownloadEngineEvent) => void) => {
      emit = fn;
      return () => {
        emit = undefined;
      };
    },
  }),
}));
mock.module('../api', () => ({
  dlStorageUsage: async () => usageTree(),
  getApiBase: () => 'http://test.local',
}));
mock.module('./index-cache', () => ({
  clearDownloadIndex: () => {},
  forgetChapter: () => {},
  forgetSeries: () => {},
  refreshChapterIndex: async () => {},
}));
mock.module('expo/fetch', () => ({ fetch: globalThis.fetch }));

const { installDownloadProgress } = await import('./events');

const USAGE_KEY = ['downloads', 'usage'] as const;

/** A storage tree holding one queued chapter of one series. */
function usageTree(chapterId = 'c1'): StorageUsage {
  return {
    totalBytes: 0,
    seriesCount: 1,
    chapterCount: 1,
    pageCount: 0,
    bySeries: [
      {
        bridgeId: 'b',
        seriesId: 's',
        title: 'T',
        chapterCount: 1,
        bytes: 0,
        addedAt: 1,
        chapters: [
          { bridgeId: 'b', seriesId: 's', chapterId, pageCount: 4, completedPages: 0, bytes: 0, state: 'queued', addedAt: 1 },
        ],
      },
    ],
  };
}

const pageEvent = (chapterId: string): DownloadEngineEvent => ({
  type: 'page',
  bridgeId: 'b',
  seriesId: 's',
  chapterId,
  index: 0,
  completedPages: 1,
  pageCount: 4,
  bytes: 120,
  state: 'downloading',
});

const usageQuery = () => queryClient.getQueryCache().find({ queryKey: USAGE_KEY })!;

beforeEach(() => {
  queryClient.clear();
  installDownloadProgress();
});

describe('page events → the storage-usage cache', () => {
  test('patches a chapter the cached tree knows about, in place', () => {
    queryClient.setQueryData<StorageUsage>(USAGE_KEY, usageTree('c1'));
    emit!(pageEvent('c1'));
    const chapter = queryClient.getQueryData<StorageUsage>(USAGE_KEY)!.bySeries[0]!.chapters[0]!;
    expect(chapter).toMatchObject({ completedPages: 1, bytes: 120, state: 'downloading' });
  });

  test('leaves a pending invalidation intact when the chapter is not in the tree yet', async () => {
    queryClient.setQueryData<StorageUsage>(USAGE_KEY, usageTree('c1'));
    await queryClient.invalidateQueries({ queryKey: USAGE_KEY }); // what an enqueue does
    expect(usageQuery().state.isInvalidated).toBe(true);

    emit!(pageEvent('freshly-enqueued')); // a chapter the cached tree predates

    // Still invalidated (so the Downloads screen refetches on mount) and untouched.
    expect(usageQuery().state.isInvalidated).toBe(true);
    expect(queryClient.getQueryData<StorageUsage>(USAGE_KEY)!.bySeries[0]!.chapters).toHaveLength(1);
  });

  test('does nothing at all when nothing is cached yet', () => {
    emit!(pageEvent('c1'));
    expect(queryClient.getQueryData(USAGE_KEY)).toBeUndefined();
  });
});
