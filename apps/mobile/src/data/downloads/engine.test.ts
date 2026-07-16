/**
 * Drives the real download engine with mocked IO to observe how it reports progress — the thing that
 * couldn't be reproduced in a browser (expo-file-system is stubbed on web). The engine advances the
 * manifest query CACHES page-by-page (`patchProgressCaches`), which is what re-renders the UI, so the
 * test captures those cache patches.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── ./state: only the key helper survives (no more live-progress overlay) ────
const key = (b: string, s: string, c: string) => `${b}:${s}:${c}`;
mock.module('./state', () => ({ chapterProgressKey: key }));

// ── In-memory manifest backend (mock of ../api) ──────────────────────────────
interface Pg { index: number; sourceUrl: string; state: string; file: string; bytes: number }
const pagesByChapter: Record<string, Pg[]> = {};
const paused = new Set<string>();

function chapterState(ch: string): string {
  if (paused.has(ch)) return 'paused';
  const ps = pagesByChapter[ch];
  if (!ps?.length) return 'queued';
  if (ps.every((p) => p.state === 'complete')) return 'complete';
  if (ps.some((p) => p.state === 'failed')) return 'failed';
  if (ps.some((p) => p.state === 'complete')) return 'downloading';
  return 'queued';
}

// Optional gate to freeze page resolution mid-download.
let gated = false;
let releaseNext: (() => void) | null = null;

mock.module('../api', () => ({
  dlPendingChapters: async () =>
    Object.keys(pagesByChapter)
      .map((ch) => ({ bridgeId: 'b', seriesId: 's', chapterId: ch, state: chapterState(ch) }))
      .filter((c) => c.state !== 'complete' && c.state !== 'paused' && c.state !== 'failed'),
  dlManifestPages: async (_b: string, _s: string, ch: string) => (pagesByChapter[ch] ?? []).map((p) => ({ ...p })),
  dlRecordPage: async (_b: string, _s: string, ch: string, i: number, file: string, bytes: number) => {
    const pg = pagesByChapter[ch]?.find((p) => p.index === i);
    if (pg) Object.assign(pg, { state: 'complete', file, bytes });
  },
  dlFailPage: async (_b: string, _s: string, ch: string, i: number) => {
    const pg = pagesByChapter[ch]?.find((p) => p.index === i);
    if (pg) pg.state = 'failed';
  },
  dlPauseSeries: async () => {
    for (const ch of Object.keys(pagesByChapter)) if (chapterState(ch) !== 'complete') paused.add(ch);
  },
  dlPauseChapter: async (_b: string, _s: string, ch: string) => paused.add(ch),
  dlResumeChapter: async (_b: string, _s: string, ch: string) => paused.delete(ch),
  dlResumeSeries: async () => paused.clear(),
  dlRequeue: async () => {},
  dlEnqueueChapter: async () => ({}),
  getChapterPages: async () => [],
  getSeriesPages: async () => [],
  resolveAssetSourceCached: async (url: string) => {
    if (gated) await new Promise<void>((r) => (releaseNext = r));
    return `resolved:${url}`;
  },
  invalidateAssetSource: () => {},
}));

mock.module('./blob-store', () => ({
  storePage: async (_b: string, _s: string, _c: string, i: number) => ({ relPath: `p${i}`, bytes: 100 }),
  uriFor: (rel: string) => `file://${rel}`,
}));
mock.module('./index-cache', () => ({ noteChapterDownloaded: () => {} }));
mock.module('./prefs', () => ({ getDownloadPrefsSync: () => ({ wifiOnly: false, background: false }) }));

// ── Query cache (mock of ../query-client): apply per-page patches to a fake usage tree ───────────
interface UsageChapter { chapterId: string; pageCount: number; bytes: number; completedPages: number; state: string }
let usage: { totalBytes: number; bySeries: { bridgeId: string; seriesId: string; bytes: number; chapters: UsageChapter[] }[] } | null;
/** completedPages of c1 recorded after each patch to the usage tree — the per-page progress the UI sees. */
const usageProgress: number[] = [];
mock.module('../query-client', () => ({
  queryClient: {
    invalidateQueries: () => {},
    // queryKeys.downloadsUsage() -> ['d']; seriesDownloads() -> ['d','s'] (see ../queries mock).
    setQueryData: (qk: unknown[], updater: unknown) => {
      if (!Array.isArray(qk) || qk.length !== 1) return; // only track the usage-tree patches here
      usage = typeof updater === 'function' ? (updater as (o: typeof usage) => typeof usage)(usage) : (updater as typeof usage);
      const ch = usage?.bySeries?.[0]?.chapters?.find((c) => c.chapterId === 'c1');
      if (ch) usageProgress.push(ch.completedPages);
    },
  },
}));
mock.module('../queries', () => ({ queryKeys: { downloadsUsage: () => ['d'], seriesDownloads: () => ['d', 's'] } }));
mock.module('expo-network', () => ({
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }),
  NetworkStateType: { WIFI: 'WIFI' },
  addNetworkStateListener: () => ({ remove: () => {} }),
}));

const { drain, pauseSeries } = await import('./engine');

const seed = (ch: string, n: number) => {
  pagesByChapter[ch] = Array.from({ length: n }, (_, i) => ({ index: i, sourceUrl: `/i/${i}`, state: 'queued', file: '', bytes: 0 }));
};
/** Seed the cached usage tree so the engine's per-page patch has a chapter to advance. */
const seedUsage = (ch: string, n: number) => {
  usage = {
    totalBytes: 0,
    bySeries: [{ bridgeId: 'b', seriesId: 's', bytes: 0, chapters: [{ chapterId: ch, pageCount: n, bytes: 0, completedPages: 0, state: 'queued' }] }],
  };
};
const tick = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const untilGate = async () => { for (let i = 0; i < 100 && !releaseNext; i++) await Promise.resolve(); };

beforeEach(() => {
  for (const k of Object.keys(pagesByChapter)) delete pagesByChapter[k];
  usage = null;
  usageProgress.length = 0;
  paused.clear();
  gated = false;
  releaseNext = null;
});

describe('engine progress via the manifest query cache', () => {
  test('advances completedPages + bytes page-by-page, then settles complete (not queued→done)', async () => {
    seed('c1', 3);
    seedUsage('c1', 3);
    await drain(); // ungated: runs to completion
    // Patched once per landed page: 1 → 2 → 3, so the list re-renders each page (not just at the end).
    expect(usageProgress).toEqual([1, 2, 3]);
    const ch = usage!.bySeries[0].chapters[0];
    expect(ch.state).toBe('complete');
    expect(ch.bytes).toBe(300); // 3 pages × 100 bytes
    expect(usage!.totalBytes).toBe(300);
  });

  test('pausing a series aborts its in-flight chapter (progress stops before completion)', async () => {
    seed('c1', 3);
    seedUsage('c1', 3);
    gated = true;
    const p = drain();
    await untilGate(); // frozen on page 0's resolve
    expect(usageProgress).toEqual([]); // nothing landed yet

    await pauseSeries('b', 's'); // user taps the series Pause
    releaseNext?.(); // let the worker unwind
    gated = false;
    await tick(50);
    await p;

    // The chapter did NOT run to completion — the pause stopped it partway.
    expect(pagesByChapter['c1'].filter((pg) => pg.state === 'complete').length).toBeLessThan(3);
    expect(paused.has('c1')).toBe(true);
  });
});
