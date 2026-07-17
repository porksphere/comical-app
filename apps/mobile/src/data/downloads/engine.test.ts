/**
 * The downloads facade + progress plumbing. The heavy lifting (the drain loop) lives in
 * `@comical/downloads` and is tested there (`packages/downloads/test/engine.test.ts` in the
 * submodule); what's left app-side and worth pinning is:
 *  - `enqueueChapter` posts WITHOUT a page list (the host resolves pages itself) and maps
 *    `direct: true` to the reserved sentinel chapter id;
 *  - the SSE frame parser turns the server's `event:`/`data:` frames into engine events (and drops
 *    pings/garbage) — the exact wire format `/downloads/events` emits.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const enqueued: { bridgeId: string; seriesId: string; chapterId: string; body: unknown }[] = [];
const bulkEnqueued: { bridgeId: string; seriesId: string; body: unknown }[] = [];

mock.module('../api', () => ({
  dlEnqueueChapter: async (bridgeId: string, seriesId: string, chapterId: string, body: unknown) => {
    enqueued.push({ bridgeId, seriesId, chapterId, body });
    return {};
  },
  dlEnqueueChapters: async (bridgeId: string, seriesId: string, body: unknown) => {
    bulkEnqueued.push({ bridgeId, seriesId, body });
    return { chapters: [] };
  },
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
  queryClient: { invalidateQueries: async () => {}, setQueryData: () => {} },
}));
mock.module('@comical/host-rn', () => ({
  getEmbeddedDownloadEngine: () => null,
}));
mock.module('expo-network', () => ({
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
  NetworkStateType: { WIFI: 'WIFI' },
}));
mock.module('expo/fetch', () => ({ fetch: globalThis.fetch }));
mock.module('../queries', () => ({
  queryKeys: {
    downloadsUsage: () => ['downloads', 'usage'] as const,
    seriesDownloads: (b: string, s: string) => ['downloads', 'series', b, s] as const,
  },
}));
mock.module('../embedded/preference', () => ({ getResolvedModeSync: () => 'remote' }));
mock.module('./prefs', () => ({ getDownloadPrefsSync: () => ({ wifiOnly: false, background: false }) }));
mock.module('./index-cache', () => ({
  clearDownloadIndex: () => {},
  forgetChapter: () => {},
  forgetSeries: () => {},
  refreshChapterIndex: async () => {},
  hydrateDownloadIndex: async () => {},
  localChapterPages: () => undefined,
}));

const { enqueueChapter, enqueueChapters } = await import('./engine');
const { parseSseFrame } = await import('./events');

beforeEach(() => {
  enqueued.length = 0;
  bulkEnqueued.length = 0;
});

describe('enqueueChapter (facade)', () => {
  test('posts the snapshot WITHOUT a page list — the host resolves pages itself', async () => {
    await enqueueChapter({ bridgeId: 'b', seriesId: 's', chapterId: 'c9', title: 'T', number: 9 });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.chapterId).toBe('c9');
    expect(enqueued[0]!.body).toEqual({ title: 'T', number: 9 });
    expect((enqueued[0]!.body as { pages?: unknown }).pages).toBeUndefined();
  });

  test('a direct series files under the reserved sentinel chapter id', async () => {
    await enqueueChapter({ bridgeId: 'b', seriesId: 's', chapterId: 'ignored', direct: true, title: 'T' });
    expect(enqueued[0]!.chapterId).toBe('__direct__');
  });
});

describe('enqueueChapters (bulk facade)', () => {
  test('lands the whole selection in ONE bulk request (no per-chapter posts)', async () => {
    enqueueChapters(
      { bridgeId: 'b', seriesId: 's', title: 'T', author: 'A' },
      [
        { id: 'c1', name: 'One', number: 1 },
        { id: 'c2', name: 'Two', number: 2, languageCode: 'en' },
      ],
    );
    await new Promise((r) => setTimeout(r, 0)); // the facade fires-and-forgets
    expect(enqueued).toHaveLength(0);
    expect(bulkEnqueued).toHaveLength(1);
    expect(bulkEnqueued[0]!.body).toEqual({
      title: 'T',
      author: 'A',
      chapters: [
        { chapterId: 'c1', chapterName: 'One', number: 1 },
        { chapterId: 'c2', chapterName: 'Two', number: 2, languageCode: 'en' },
      ],
    });
  });

  test('an empty selection is a no-op', async () => {
    enqueueChapters({ bridgeId: 'b', seriesId: 's', title: 'T' }, []);
    await new Promise((r) => setTimeout(r, 0));
    expect(bulkEnqueued).toHaveLength(0);
  });
});

describe('parseSseFrame', () => {
  test('parses an engine event frame', () => {
    const e = parseSseFrame('event: page\ndata: {"type":"page","bridgeId":"b","seriesId":"s","chapterId":"c","index":0,"completedPages":1,"pageCount":4,"bytes":100,"state":"downloading"}');
    expect(e).toMatchObject({ type: 'page', chapterId: 'c', completedPages: 1 });
  });

  test('ignores keepalive pings and malformed frames', () => {
    expect(parseSseFrame('event: ping\ndata: ')).toBeNull();
    expect(parseSseFrame('')).toBeNull();
    expect(parseSseFrame('event: chapter\ndata: {not json')).toBeNull();
    expect(parseSseFrame('data: {"type":"idle"}')).toBeNull(); // no event name
  });

  test('parses a chapter frame with an SSE comment line mixed in', () => {
    const e = parseSseFrame(': keepalive\nevent: chapter\ndata: {"type":"chapter","chapter":{"state":"complete"}}');
    expect(e).toMatchObject({ type: 'chapter' });
  });
});
