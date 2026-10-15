/**
 * Auto-download on save: each kind of item is gated by its own pref, a page goes out as a partial
 * chapter, and a series enqueues only the chapters not already kept or queued.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DownloadedChapter } from '@comical/downloads';

import type { Chapter } from '../types';

const enqueued: { chapterId: string; body: Record<string, unknown> }[] = [];
const bulkEnqueued: { body: { chapters: { chapterId: string }[] } }[] = [];
const diagnostics: string[] = [];
const prefs = { wifiOnly: false, background: false, autoSeries: true, autoChapters: true, autoPages: true };
let chapterList: Chapter[] = [];
let manifest: DownloadedChapter[] | null = null;
let listError: Error | null = null;
let cachedDetail: { cover?: string } | undefined;

mock.module('../api', () => ({
  dlEnqueueChapter: async (_b: string, _s: string, chapterId: string, body: Record<string, unknown>) => {
    enqueued.push({ chapterId, body });
    return {};
  },
  dlEnqueueChapters: async (_b: string, _s: string, body: { chapters: { chapterId: string }[] }) => {
    bulkEnqueued.push({ body });
    return { chapters: [] };
  },
  dlGetSeries: async () => (manifest ? { chapters: manifest } : null),
  dlPauseChapter: async () => ({}),
  dlPauseSeries: async () => ({}),
  dlResumeChapter: async () => ({}),
  dlResumeSeries: async () => ({}),
  dlRequeue: async () => [],
  dlStorageUsage: async () => ({ totalBytes: 0, seriesCount: 0, chapterCount: 0, pageCount: 0, bySeries: [] }),
  getApiBase: () => 'http://test.local',
  invalidateAssetSource: () => {},
  resolveAssetSourceCached: async (u: string) => u,
}));
mock.module('../query-client', () => ({
  queryClient: {
    invalidateQueries: async () => {},
    setQueryData: () => {},
    getQueryData: () => cachedDetail,
    fetchQuery: async ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn(),
  },
}));
mock.module('../queries', () => ({
  queryKeys: {
    downloadsUsage: () => ['downloads', 'usage'] as const,
    seriesDownloads: (b: string, s: string) => ['downloads', 'series', b, s] as const,
    seriesDetail: (m: boolean, b: string, s: string, d: boolean) => ['seriesDetail', m, b, s, d] as const,
  },
  seriesListQuery: (_ds: unknown, _m: boolean, b: string, s: string, d: boolean) => ({
    queryKey: ['seriesList', b, s, d],
    queryFn: async () => {
      if (listError) throw listError;
      return { chapters: chapterList };
    },
  }),
}));
mock.module('@comical/host-rn', () => ({ getEmbeddedDownloadEngine: () => null }));
mock.module('expo-network', () => ({
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
  NetworkStateType: { WIFI: 'WIFI' },
}));
mock.module('./prefs', () => ({ getDownloadPrefsSync: () => prefs }));
mock.module('@/lib/preferred-group', () => ({ getPreferredGroup: () => undefined }));
mock.module('@/lib/diagnostics', () => ({
  logDiagnostic: (_category: string, message: string) => diagnostics.push(message),
}));

const { autoDownloadChapter, autoDownloadPage, autoDownloadSeries } = await import('./auto');

const ds = {} as Parameters<typeof autoDownloadSeries>[0];
const SERIES = { bridgeId: 'b', seriesId: 's', title: 'T' };
const flush = () => new Promise((r) => setTimeout(r, 0));
const ch = (id: string, number: number): Chapter => ({ id, name: `Ch ${number}`, date: number, number });
const dl = (chapterId: string, over: Partial<DownloadedChapter> = {}): DownloadedChapter =>
  ({ bridgeId: 'b', seriesId: 's', chapterId, state: 'complete', pageCount: 1, completedPages: 1, bytes: 0, addedAt: 0, ...over }) as DownloadedChapter;

beforeEach(() => {
  enqueued.length = 0;
  bulkEnqueued.length = 0;
  diagnostics.length = 0;
  Object.assign(prefs, { autoSeries: true, autoChapters: true, autoPages: true });
  chapterList = [];
  manifest = null;
  listError = null;
  cachedDetail = undefined;
});

describe('autoDownloadPage', () => {
  test('enqueues just that page as a partial chapter', async () => {
    autoDownloadPage(false, { ...SERIES, chapterId: 'c1', pageIndex: 4, chapterName: 'One' });
    await flush();
    expect(enqueued).toEqual([{ chapterId: 'c1', body: { title: 'T', chapterName: 'One', onlyPages: [4] } }]);
  });

  test("a direct series' page goes under the reserved direct chapter", async () => {
    autoDownloadPage(false, { ...SERIES, chapterId: '__direct__', pageIndex: 0 });
    await flush();
    expect(enqueued[0]).toMatchObject({ chapterId: '__direct__', body: { onlyPages: [0] } });
  });

  test('off, or in mock mode, does nothing', async () => {
    autoDownloadPage(true, { ...SERIES, chapterId: 'c1', pageIndex: 0 });
    prefs.autoPages = false;
    autoDownloadPage(false, { ...SERIES, chapterId: 'c1', pageIndex: 0 });
    await flush();
    expect(enqueued).toHaveLength(0);
  });

  test('borrows the cover from a cached series detail', async () => {
    cachedDetail = { cover: 'https://example.com/c.jpg' };
    autoDownloadPage(false, { ...SERIES, chapterId: 'c1', pageIndex: 1 });
    await flush();
    expect(enqueued[0]!.body.thumbnailUrl).toBe('https://example.com/c.jpg');
  });
});

describe('autoDownloadChapter', () => {
  test('enqueues the whole chapter', async () => {
    autoDownloadChapter(false, { ...SERIES, chapterId: 'c2', chapterName: 'Two', number: 2 });
    await flush();
    expect(enqueued).toEqual([{ chapterId: 'c2', body: { title: 'T', chapterName: 'Two', number: 2 } }]);
  });

  test('is gated by its own pref, not the others', async () => {
    prefs.autoChapters = false;
    autoDownloadChapter(false, { ...SERIES, chapterId: 'c2' });
    await flush();
    expect(enqueued).toHaveLength(0);
  });
});

describe('autoDownloadSeries', () => {
  test('bulk-enqueues every chapter not already kept, counting a saved-pages chapter as missing', async () => {
    chapterList = [ch('c1', 1), ch('c2', 2), ch('c3', 3)];
    manifest = [dl('c1'), dl('c2', { onlyPages: [0] })];
    autoDownloadSeries(ds, false, SERIES);
    await flush();
    await flush();
    expect(bulkEnqueued).toHaveLength(1);
    expect(bulkEnqueued[0]!.body.chapters.map((c) => c.chapterId)).toEqual(['c2', 'c3']);
  });

  test('a direct series enqueues its single page set', async () => {
    autoDownloadSeries(ds, false, { ...SERIES, direct: true });
    await flush();
    expect(enqueued).toEqual([{ chapterId: '__direct__', body: { title: 'T' } }]);
    expect(bulkEnqueued).toHaveLength(0);
  });

  test('an empty chapter list downloads nothing', async () => {
    autoDownloadSeries(ds, false, SERIES);
    await flush();
    await flush();
    expect(bulkEnqueued).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  test('a failed chapter-list fetch is logged, not thrown', async () => {
    listError = new Error('bridge down');
    autoDownloadSeries(ds, false, SERIES);
    await flush();
    await flush();
    expect(diagnostics).toEqual(['bridge down']);
  });

  test('off does nothing', async () => {
    prefs.autoSeries = false;
    chapterList = [ch('c1', 1)];
    autoDownloadSeries(ds, false, SERIES);
    autoDownloadSeries(ds, false, { ...SERIES, direct: true });
    await flush();
    await flush();
    expect(bulkEnqueued).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });
});
