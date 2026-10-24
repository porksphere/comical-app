import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { pairingGate } from '@comical/sync';

// A real pairing: the test hub is the real gate behind a stubbed fetch, so the sealed channel is exercised, not faked.
const KEY = `${'A'.repeat(43)}=`;
let pairing: { id: string; key: string } | null = { id: 'phone', key: KEY };
let mode = 'embedded';
let prefs = { fromHub: true };
mock.module('../api', () => ({ getApiBase: () => 'http://hub.test:3130', getSyncPairing: () => pairing }));
mock.module('../embedded/preference', () => ({ getResolvedModeSync: () => mode }));
mock.module('./prefs', () => ({ getDownloadPrefsSync: () => prefs }));
mock.module('@/lib/diagnostics', () => ({ logDiagnostic: () => {} }));
mock.module('react-native', () => ({ AppState: { addEventListener: () => ({ remove: () => {} }) } }));
mock.module('expo-network', () => ({ addNetworkStateListener: () => ({ remove: () => {} }) }));

const { hubChapterPages, hubFirst, hubState, noteSyncStatus, resetHubDownloads, HAVE_TTL_MS, RECENT_MS } = await import('./hub');

/** What the hub answers a sealed read of a path with — or a hang, or a dead network. */
type Answer = { status: number; body: unknown } | 'hang' | 'down';
const hub = new Map<string, Answer>();
const reads: string[] = [];
const gate = pairingGate({
  pairings: [{ id: 'phone', name: 'Phone', key: KEY, pairedAt: 0, lastSeenAt: null }],
  save: () => {},
  onDevices: () => {},
  reads: () => true,
  forward: async ({ path }) => {
    const answer = hub.get(path) as { status: number; body: unknown } | undefined;
    return answer ? { status: answer.status, body: JSON.stringify(answer.body) } : { status: 404, body: '{"error":"not found"}' };
  },
});
/** A plain (ticketed) page GET, outside the sealed channel. */
let pageGet: (url: string) => Promise<Response> = async () => new Response('nope', { status: 404 });

const stubFetch = (async (url: string, init?: RequestInit) => {
  const { pathname } = new URL(url);
  if (/\/pages\/\d+\/file$/.test(pathname)) return pageGet(url);
  reads.push(pathname);
  const answer = hub.get(pathname);
  if (answer === 'down') throw new TypeError('Network request failed');
  if (answer === 'hang') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  const reply = await gate.handle(pathname, String(init?.body));
  return reply === null ? new Response('not found', { status: 404 }) : new Response(reply, { status: 200 });
}) as typeof fetch;

const chapter = (chapterId: string, pageCount = 3, extra: Record<string, unknown> = {}) => ({
  chapterId,
  state: 'complete',
  onlyPages: false,
  pageCount,
  ...extra,
});
const usage = (chapters: unknown[]) => ({ bySeries: [{ bridgeId: 'b', seriesId: 's', chapters }] });
const ticket = (value = 'T1') => ({ status: 200, body: { ticket: value, expiresInMs: 60 * 60_000 } });
const realFetch = globalThis.fetch;
const realNow = Date.now;
const settled = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  globalThis.fetch = stubFetch;
  resetHubDownloads();
  hub.clear();
  reads.length = 0;
  hub.set('/downloads', { status: 200, body: usage([chapter('c1'), chapter('part', 3, { state: 'downloading' }), chapter('few', 2, { onlyPages: true })]) });
  hub.set('/downloads/entries/b/s', { status: 200, body: { series: {}, chapters: [chapter('c1')] } });
  hub.set('/sync/ticket', ticket());
  // A sync round just landed, which is how the "have" normally arrives.
  noteSyncStatus({ enabled: true, running: false, lastSyncAt: Date.now() });
  await settled();
  await settled();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  pairing = { id: 'phone', key: KEY };
  mode = 'embedded';
  prefs = { fromHub: true };
  pageGet = async () => new Response('nope', { status: 404 });
});

const HUB_PAGE = (c: string, i: number) => `http://hub.test:3130/downloads/entries/b/s/chapters/${c}/pages/${i}/file?t=T1`;

describe('hubChapterPages', () => {
  test('serves a chapter the hub holds complete as ticketed page URLs, and nothing else', async () => {
    expect(reads).toEqual(['/downloads', '/sync/ticket']);
    expect(await hubChapterPages('b', 's', 'c1')).toEqual([HUB_PAGE('c1', 0), HUB_PAGE('c1', 1), HUB_PAGE('c1', 2)]);
    expect(await hubChapterPages('b', 's', 'part')).toBeUndefined();
    expect(await hubChapterPages('b', 's', 'few')).toBeUndefined();
    expect(await hubChapterPages('b', 's', 'nope')).toBeUndefined();
    // Heard from a moment ago: the chapter was served without a probe.
    expect(reads).toEqual(['/downloads', '/sync/ticket']);
  });

  test('is off when not paired, not on-device, or turned off — with no request made', async () => {
    reads.length = 0;
    pairing = null;
    expect(await hubChapterPages('b', 's', 'c1')).toBeUndefined();
    pairing = { id: 'phone', key: KEY };
    mode = 'remote';
    expect(await hubChapterPages('b', 's', 'c1')).toBeUndefined();
    mode = 'embedded';
    prefs = { fromHub: false };
    expect(await hubChapterPages('b', 's', 'c1')).toBeUndefined();
    expect(reads).toEqual([]);
  });

  test('a hub not heard from for a while is probed once, and the probe corrects what it has', async () => {
    reads.length = 0;
    const start = Date.now();
    Date.now = () => start + RECENT_MS + 1;
    // The hub has since lost c1 and gained c2.
    hub.set('/downloads/entries/b/s', { status: 200, body: { series: {}, chapters: [chapter('c2', 1)] } });
    expect(await hubChapterPages('b', 's', 'c1')).toBeUndefined();
    expect(reads).toEqual(['/downloads/entries/b/s']);
    expect(hubState().reachable).toBe(true);
    // c2 is known from the probe, and the hub was just heard from, so no second probe.
    expect(await hubChapterPages('b', 's', 'c2')).toEqual([HUB_PAGE('c2', 0)]);
    expect(reads).toEqual(['/downloads/entries/b/s']);
  });

  test('a probe that fails clears the latch: the next chapters open from the bridge at no cost', async () => {
    reads.length = 0;
    const start = Date.now();
    Date.now = () => start + RECENT_MS + 1;
    hub.set('/downloads/entries/b/s', 'down');
    expect(await hubChapterPages('b', 's', 'c1')).toBeUndefined();
    expect(hubState().reachable).toBe(false);
    expect(await hubChapterPages('b', 's', 'c1')).toBeUndefined();
    expect(reads).toEqual(['/downloads/entries/b/s']);

    // Word from the hub — a sync round landing — sets it again.
    hub.set('/downloads/entries/b/s', { status: 200, body: { series: {}, chapters: [chapter('c1')] } });
    noteSyncStatus({ enabled: true, running: false, lastSyncAt: Date.now() });
    await settled();
    expect(hubState().reachable).toBe(true);
    expect(await hubChapterPages('b', 's', 'c1')).toHaveLength(3);
  });

  test('a hung probe is abandoned at the bound', async () => {
    const start = Date.now();
    Date.now = () => start + RECENT_MS + 1;
    hub.set('/downloads/entries/b/s', 'hang');
    const began = performance.now();
    expect(await hubChapterPages('b', 's', 'c1')).toBeUndefined();
    expect(performance.now() - began).toBeLessThan(3000);
    expect(hubState().reachable).toBe(false);
  });

  test('a failed sync round clears the latch; a later round that lands re-reads what the hub has', async () => {
    expect(hubState().have).toBe(1);
    noteSyncStatus({ enabled: true, running: false, lastError: 'Network request failed' });
    expect(hubState().reachable).toBe(false);
    expect(await hubChapterPages('b', 's', 'c1')).toBeUndefined();

    hub.set('/downloads', { status: 200, body: usage([chapter('c1'), chapter('c3', 2)]) });
    const start = Date.now();
    Date.now = () => start + HAVE_TTL_MS + 1;
    noteSyncStatus({ enabled: true, running: false, lastSyncAt: Date.now() });
    await settled();
    await settled();
    expect(hubState()).toEqual({ reachable: true, have: 2, ticket: 'T1' });
    // The same round reported again (now "running") re-reads nothing.
    reads.length = 0;
    noteSyncStatus({ enabled: true, running: true, lastSyncAt: start + HAVE_TTL_MS + 1 });
    await settled();
    expect(reads).toEqual([]);
  });

  test('the first chapter opened before any round has landed reads the hub once', async () => {
    resetHubDownloads();
    reads.length = 0;
    expect(await hubChapterPages('b', 's', 'c1')).toHaveLength(3);
    expect(reads).toEqual(['/downloads', '/sync/ticket']);
  });
});

describe('hubFirst', () => {
  const CTX = { bridgeId: 'b', seriesId: 's', chapterId: 'c1' };
  const page = (index: number) => ({ index, sourceUrl: 'https://cdn.test/p.png', file: '', bytes: 0, state: 'pending' as const });

  test('takes a page the hub holds from it, without asking the source', async () => {
    const asked: number[] = [];
    const fetcher = hubFirst(async (_ctx, p) => {
      asked.push(p.index);
      return { data: new Uint8Array([9]) };
    });
    pageGet = async (url) => {
      expect(url).toBe(HUB_PAGE('c1', 1));
      return new Response(new Uint8Array([7, 8]), { headers: { 'Content-Type': 'image/webp' } });
    };
    const got = await fetcher(CTX, page(1));
    expect([...got.data]).toEqual([7, 8]);
    expect(got.contentType).toBe('image/webp');
    expect(asked).toEqual([]);
    // A chapter the hub hasn't goes straight to the source.
    expect([...(await fetcher({ ...CTX, chapterId: 'nope' }, page(0))).data]).toEqual([9]);
    expect(asked).toEqual([0]);
  });

  test("a hub copy that doesn't arrive falls through to the source and clears the latch; a 404 only falls through", async () => {
    const fetcher = hubFirst(async () => ({ data: new Uint8Array([1]) }));
    expect([...(await fetcher(CTX, page(1))).data]).toEqual([1]);
    expect(hubState().reachable).toBe(true);

    pageGet = async () => {
      throw new TypeError('Network request failed');
    };
    expect([...(await fetcher(CTX, page(1))).data]).toEqual([1]);
    expect(hubState().reachable).toBe(false);
    // And from here the hub is not asked at all.
    pageGet = async () => {
      throw new Error('should not be called');
    };
    expect([...(await fetcher(CTX, page(1))).data]).toEqual([1]);
  });
});
