/**
 * Auto-download on save: each kind of item is gated by its own pref (and its bridge's opt-out), a page goes out as a partial
 * chapter, and a series enqueues only the chapters not already kept or queued. Plus the two ways in
 * outside a save: downloading the whole library, and downloading what syncs find.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DownloadedChapter } from '@comical/downloads';

import type { Chapter } from '../types';

const enqueued: { chapterId: string; body: Record<string, unknown> }[] = [];
const bulkEnqueued: { seriesId: string; body: { chapters: { chapterId: string }[] } }[] = [];
const diagnostics: string[] = [];
const prefs = { wifiOnly: false, background: false, autoSeries: true, autoChapters: true, autoPages: true, autoNew: true };
let chapterList: Chapter[] = [];
let manifest: DownloadedChapter[] | null = null;
let listError: Error | null = null;
let cachedDetail: { cover?: string } | undefined;
let library: { bridgeId: string; seriesId: string; seriesTitle: string; knownCount: number }[] = [];
let bridges: { id: string; capabilities: string[] }[] = [];
let saved: Record<string, Chapter[]> = {};
let activity: { bridgeId: string; seriesId: string; chapterId: string; title: string; detectedAt: number; read: boolean }[] = [];
let bulkFails = false;
let activityGate: Promise<void> = Promise.resolve();
const persistedStores = new Map<string, { value: unknown }>();
let bridgeOptOuts: Record<string, Partial<Record<keyof typeof prefs, boolean>>> = {};

mock.module('../api', () => ({
  dlEnqueueChapter: async (_b: string, _s: string, chapterId: string, body: Record<string, unknown>) => {
    enqueued.push({ chapterId, body });
    return {};
  },
  dlEnqueueChapters: async (_b: string, s: string, body: { chapters: { chapterId: string }[] }) => {
    if (bulkFails) throw new Error('server down');
    bulkEnqueued.push({ seriesId: s, body });
    return { chapters: [] };
  },
  dlGetSeries: async () => (manifest ? { chapters: manifest } : null),
  dlPauseChapter: async () => ({}),
  dlPauseSeries: async () => ({}),
  dlResumeChapter: async () => ({}),
  dlResumeSeries: async () => ({}),
  dlRequeue: async () => [],
  dlStorageUsage: async () => ({ totalBytes: 0, seriesCount: 0, chapterCount: 0, pageCount: 0, bySeries: [] }),
  getActivity: async () => {
    await activityGate;
    return activity;
  },
  getApiBase: () => 'http://test.local',
  getBridges: async () => bridges,
  getLibrary: async () => library,
  getSavedChapters: async (_b: string, s: string) =>
    saved[s] ? { chapters: saved[s]!.map((c) => ({ ...c, publishedAt: c.date })), cachedAt: 0 } : null,
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
mock.module('./prefs', () => ({
  getDownloadPrefsSync: () => prefs,
  downloadPrefs$: { autoNew: { set: (v: boolean) => (prefs.autoNew = v) } },
  bridgeAutoDownload$: {},
  autoDownloadsFor: (bridgeId: string, kind: 'autoSeries' | 'autoNew' | 'autoChapters' | 'autoPages') =>
    prefs[kind] && bridgeOptOuts[bridgeId]?.[kind] !== false,
}));
mock.module('@/lib/observable', () => ({
  persisted$: (name: string, initial: unknown) => {
    const box = { value: initial };
    persistedStores.set(name, box);
    return { peek: () => box.value, set: (v: unknown) => (box.value = v) };
  },
  whenPersistLoaded: async () => {},
}));
mock.module('@/lib/preferred-group', () => ({ getPreferredGroup: () => undefined }));
mock.module('@/lib/diagnostics', () => ({
  logDiagnostic: (_category: string, message: string) => diagnostics.push(message),
}));

const {
  autoDownloadChapter,
  autoDownloadLibrary,
  autoDownloadNewChapters,
  autoDownloadPage,
  autoDownloadSeries,
  librarySize,
  setAutoNewChapters,
} = await import('./auto');
const watermark = persistedStores.get('comical:dl:autoNewSince')!;

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
  Object.assign(prefs, { autoSeries: true, autoChapters: true, autoPages: true, autoNew: true });
  chapterList = [];
  manifest = null;
  listError = null;
  cachedDetail = undefined;
  library = [];
  bridges = [];
  saved = {};
  activity = [];
  bulkFails = false;
  activityGate = Promise.resolve();
  watermark.value = 100;
  bridgeOptOuts = {};
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

  test("a bridge that opted out of chapters is skipped, while its pages still go", async () => {
    bridgeOptOuts = { b: { autoChapters: false } };
    autoDownloadChapter(false, { ...SERIES, chapterId: 'c2' });
    autoDownloadChapter(false, { ...SERIES, bridgeId: 'other', chapterId: 'c3' });
    autoDownloadPage(false, { ...SERIES, chapterId: 'c4', pageIndex: 0 });
    await flush();
    expect(enqueued.map((e) => e.chapterId)).toEqual(['c3', 'c4']);
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

const entry = (seriesId: string, knownCount = 1) => ({ bridgeId: 'b', seriesId, seriesTitle: seriesId.toUpperCase(), knownCount });
const bulkIds = () => bulkEnqueued.map((e) => [e.seriesId, e.body.chapters.map((c) => c.chapterId)]);

describe('autoDownloadLibrary', () => {
  test("enqueues each series' missing chapters from its stored list, skipping uninstalled bridges", async () => {
    library = [entry('s1'), entry('s2'), { ...entry('x'), bridgeId: 'gone' }];
    bridges = [{ id: 'b', capabilities: [] }];
    saved = { s1: [ch('a', 1), ch('b', 2)], s2: [ch('c', 1)], x: [ch('d', 1)] };
    manifest = [dl('a')];
    expect(await autoDownloadLibrary(ds, false)).toBe(2);
    expect(bulkIds()).toEqual([
      ['s1', ['b']],
      ['s2', ['c']],
    ]);
  });

  test('a series with no stored list asks the bridge', async () => {
    library = [entry('s1')];
    bridges = [{ id: 'b', capabilities: [] }];
    chapterList = [ch('live', 1)];
    await autoDownloadLibrary(ds, false);
    expect(bulkIds()).toEqual([['s1', ['live']]]);
  });

  test("a direct bridge's series enqueues its single page set", async () => {
    library = [entry('s1')];
    bridges = [{ id: 'b', capabilities: ['direct'] }];
    await autoDownloadLibrary(ds, false);
    expect(enqueued).toEqual([{ chapterId: '__direct__', body: { title: 'S1' } }]);
  });

  test('one failing series is logged and the rest still go', async () => {
    library = [entry('s1'), entry('s2')];
    bridges = [{ id: 'b', capabilities: [] }];
    saved = { s2: [ch('c', 1)] };
    listError = new Error('bridge down');
    expect(await autoDownloadLibrary(ds, false)).toBe(1);
    expect(diagnostics).toEqual(['bridge down']);
    expect(bulkIds()).toEqual([['s2', ['c']]]);
  });

  test('librarySize totals series and known chapters', async () => {
    library = [entry('s1', 10), entry('s2', 5)];
    expect(await librarySize()).toEqual({ series: 2, chapters: 15 });
  });

  test("a bridge that opted out of series is left out of both the download and the offer", async () => {
    library = [entry('s1', 10), { ...entry('s2', 5), bridgeId: 'off' }];
    bridges = [
      { id: 'b', capabilities: [] },
      { id: 'off', capabilities: [] },
    ];
    saved = { s1: [ch('a', 1)], s2: [ch('c', 1)] };
    bridgeOptOuts = { off: { autoSeries: false } };
    expect(await librarySize()).toEqual({ series: 1, chapters: 10 });
    expect(await autoDownloadLibrary(ds, false)).toBe(1);
    expect(bulkIds()).toEqual([['s1', ['a']]]);
  });

  test('asked for one bridge, takes only its series and ignores the toggle and its opt-out', async () => {
    library = [entry('s1', 10), { ...entry('s2', 5), bridgeId: 'off' }, { ...entry('s3', 2), bridgeId: 'off' }];
    bridges = [
      { id: 'b', capabilities: [] },
      { id: 'off', capabilities: [] },
    ];
    saved = { s1: [ch('a', 1)], s2: [ch('c', 1)], s3: [ch('d', 1)] };
    bridgeOptOuts = { off: { autoSeries: false } };
    prefs.autoSeries = false;
    expect(await librarySize('off')).toEqual({ series: 2, chapters: 7 });
    expect(await autoDownloadLibrary(ds, false, 'off')).toBe(2);
    expect(bulkIds()).toEqual([
      ['s2', ['c']],
      ['s3', ['d']],
    ]);
  });
});

const item = (seriesId: string, chapterId: string, detectedAt: number, read = false) => ({
  bridgeId: 'b',
  seriesId,
  chapterId,
  title: seriesId.toUpperCase(),
  detectedAt,
  read,
});

describe('autoDownloadNewChapters', () => {
  test('downloads the unread chapters found since the watermark, then advances it', async () => {
    saved = { s1: [ch('old', 1), ch('n1', 2), ch('n2', 3)], s2: [ch('r', 1)] };
    activity = [item('s1', 'old', 50), item('s1', 'n1', 150), item('s1', 'n2', 160), item('s2', 'r', 170, true)];
    await autoDownloadNewChapters(false);
    expect(bulkIds()).toEqual([['s1', ['n1', 'n2']]]);
    expect(watermark.value).toBe(170);
  });

  test("a bridge that opted out of new chapters is skipped, and the watermark still advances", async () => {
    saved = { s1: [ch('n1', 1)], s2: [ch('m1', 1)] };
    activity = [item('s1', 'n1', 150), { ...item('s2', 'm1', 160), bridgeId: 'off' }];
    bridgeOptOuts = { off: { autoNew: false } };
    await autoDownloadNewChapters(false);
    expect(bulkIds()).toEqual([['s1', ['n1']]]);
    expect(watermark.value).toBe(160);
  });

  test('a chapter already kept is not enqueued again', async () => {
    saved = { s1: [ch('n1', 1), ch('n2', 2)] };
    manifest = [dl('n1')];
    activity = [item('s1', 'n1', 150), item('s1', 'n2', 160)];
    await autoDownloadNewChapters(false);
    expect(bulkIds()).toEqual([['s1', ['n2']]]);
  });

  test('a failed series holds the watermark below its chapters', async () => {
    saved = { s1: [ch('n1', 1)] };
    activity = [item('s1', 'n1', 150), item('s1', 'n2', 160)];
    bulkFails = true;
    await autoDownloadNewChapters(false);
    expect(watermark.value).toBe(149);
  });

  test('never stamped starts from now and downloads nothing', async () => {
    watermark.value = 0;
    saved = { s1: [ch('n1', 1)] };
    activity = [item('s1', 'n1', 150)];
    await autoDownloadNewChapters(false);
    expect(bulkEnqueued).toHaveLength(0);
    expect(watermark.value as number).toBeGreaterThan(1_000_000);
  });

  test('turning it on stamps the watermark', () => {
    prefs.autoNew = false;
    setAutoNewChapters(true);
    expect(prefs.autoNew).toBe(true);
    expect(watermark.value as number).toBeGreaterThan(1_000_000);
  });

  test('concurrent passes share one run', async () => {
    let open!: () => void;
    activityGate = new Promise((r) => (open = r));
    saved = { s1: [ch('n1', 1)] };
    activity = [item('s1', 'n1', 150)];
    const a = autoDownloadNewChapters(false);
    const b = autoDownloadNewChapters(false);
    expect(b).toBe(a);
    open();
    await Promise.all([a, b]);
    expect(bulkEnqueued).toHaveLength(1);
  });

  test('off, or in mock mode, does nothing', async () => {
    saved = { s1: [ch('n1', 1)] };
    activity = [item('s1', 'n1', 150)];
    await autoDownloadNewChapters(true);
    prefs.autoNew = false;
    await autoDownloadNewChapters(false);
    expect(bulkEnqueued).toHaveLength(0);
    expect(watermark.value).toBe(100);
  });
});
