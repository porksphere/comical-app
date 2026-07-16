/**
 * Drives the real download engine with mocked IO to observe the live-progress state transitions —
 * the thing that couldn't be reproduced in a browser (expo-file-system is stubbed on web).
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── Captured live progress (mock of ./state) ─────────────────────────────────
const progress: Record<string, { state: string; done: number; total: number } | null> = {};
const log: string[] = []; // ordered "state:done" (or "clear") per setChapterProgress/clear
const key = (b: string, s: string, c: string) => `${b}:${s}:${c}`;
mock.module('./state', () => ({
  chapterProgressKey: key,
  setChapterProgress: (k: string, status: { state: string; done: number; total: number }) => {
    progress[k] = status;
    log.push(`${status.state}:${status.done}`);
  },
  clearChapterProgress: (k: string) => {
    progress[k] = null;
    log.push('clear');
  },
  clearSeriesProgress: (b: string, s: string) => {
    const prefix = `${b}:${s}:`;
    for (const k of Object.keys(progress)) if (k.startsWith(prefix)) progress[k] = null;
  },
}));

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
mock.module('../query-client', () => ({ queryClient: { invalidateQueries: () => {} } }));
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
const tick = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const untilGate = async () => { for (let i = 0; i < 100 && !releaseNext; i++) await Promise.resolve(); };

beforeEach(() => {
  for (const k of Object.keys(pagesByChapter)) delete pagesByChapter[k];
  for (const k of Object.keys(progress)) delete progress[k];
  log.length = 0;
  paused.clear();
  gated = false;
  releaseNext = null;
});

describe('engine live progress', () => {
  test('reports downloading + per-page progress, then clears on complete (not queued→done)', async () => {
    seed('c1', 3);
    await drain(); // ungated: runs to completion
    // The engine must have walked through downloading 0→1→2→3 then cleared — NOT jumped straight to done.
    expect(log).toEqual(['downloading:0', 'downloading:1', 'downloading:2', 'downloading:3', 'clear']);
    expect(progress[key('b', 's', 'c1')]).toBeNull();
  });

  test('pauseSeries clears the in-flight chapter live progress (must not stay downloading)', async () => {
    seed('c1', 3);
    gated = true;
    const p = drain();
    await untilGate(); // frozen on page 0's resolve
    expect(progress[key('b', 's', 'c1')]).toEqual({ state: 'downloading', done: 0, total: 3, bytes: 0 });

    await pauseSeries('b', 's'); // user taps the series Pause
    releaseNext?.(); // let the worker unwind
    gated = false;
    await tick(50);
    await p;

    expect(progress[key('b', 's', 'c1')]?.state).not.toBe('downloading');
  });
});
