/**
 * `peekResolvedAssetSource` — the synchronous half of the asset resolver.
 *
 * It exists so a component can render an already-known asset URL during the SAME render that
 * receives it, instead of learning it a commit later from an effect. That lateness is what let a
 * recycled `<Image>` pair a new `recyclingKey` with the previous item's URI and paint the old cover
 * (see `hooks/use-resolved-asset.ts`), so the invariant worth pinning is: whatever
 * `resolveAssetSourceCached` will eventually answer, `peek` answers identically the moment it's
 * knowable — and answers `undefined` (never a stale or wrong URL) when it isn't.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// `api.ts` reaches react-native through its persisted-observable/diagnostics helpers, which bun
// can't parse (Flow-typed `react-native/index.js`). Only the resolver is under test here, and it
// needs nothing from those beyond `getApiBase`'s backing store — so stub them, exactly as
// `downloads/engine.test.ts` stubs its own heavy imports.
mock.module('@/lib/observable', () => ({
  persisted$: () => ({ url: null, get: () => ({ url: null }), peek: () => ({ url: null }), set: () => {} }),
}));
mock.module('@/lib/diagnostics', () => ({ logDiagnostic: () => {} }));
mock.module('@legendapp/state/react', () => ({ use$: (o: unknown) => o }));
// Mutable so the queue tests below can put the resolver on the EMBEDDED path, which is the only one
// that does a round-trip and therefore the only one that queues at all.
let resolvedMode = 'remote';
mock.module('./embedded/preference', () => ({ getResolvedModeSync: () => resolvedMode }));

const {
  invalidateAssetSource,
  peekResolvedAssetSource,
  releaseAssetResolve,
  resolveAssetSourceCached,
  setTransport,
  supersedeBackgroundResolves,
  assetResolvesInFlight,
} = await import('./api');

describe('peekResolvedAssetSource', () => {
  test('an absolute URL is knowable immediately, with no resolve at all', async () => {
    const url = 'https://cdn.example.com/cover-abs.webp';
    expect(peekResolvedAssetSource(url)).toBe(url);
    expect(await resolveAssetSourceCached(url)).toBe(url);
  });

  test('a server-relative path is unknown until resolved, then matches the async answer', async () => {
    const url = '/img-proxy?url=cover-rel.webp';
    expect(peekResolvedAssetSource(url)).toBeUndefined();

    const resolved = await resolveAssetSourceCached(url);
    expect(peekResolvedAssetSource(url)).toBe(resolved);
  });

  test('invalidating drops the sync answer too, so a retry re-resolves', async () => {
    const url = '/img-proxy?url=cover-invalidate.webp';
    await resolveAssetSourceCached(url);
    expect(peekResolvedAssetSource(url)).toBeDefined();

    invalidateAssetSource(url);
    expect(peekResolvedAssetSource(url)).toBeUndefined();
  });

  test('never answers for a path it has not resolved (no stale/adjacent hits)', () => {
    expect(peekResolvedAssetSource('/img-proxy?url=never-resolved.webp')).toBeUndefined();
  });
});

/**
 * The ORDER resolves are served in — the whole of why a page could take twenty seconds to appear.
 *
 * A bridge that has to resolve page URLs answers them one at a time, so nothing about a resolve is
 * negotiable except its place in the queue. These pin the three rules that place depends on; see
 * the queue's own comment in `api.ts` for what each one is worth.
 */
describe('the resolve queue', () => {
  /** A transport that answers only when told to, so a test can hold requests open and inspect the
   *  order they were STARTED in — which is the thing under test. Answers as a redirect, the cheap
   *  branch of `resolveAssetSource` (no body to read back). */
  function controllableTransport() {
    const started: string[] = [];
    const release: (() => void)[] = [];
    setTransport((path: string) => {
      started.push(path);
      return new Promise((resolve) => {
        release.push(() =>
          resolve({
            status: 302,
            ok: false,
            headers: { get: (h: string) => (h === 'Location' ? `https://cdn.example.com${path}` : null) },
          } as unknown as Response),
        );
      });
    });
    return {
      started,
      /** Let every request answered so far finish, and give the queue a turn to start more. */
      async drain() {
        while (release.length) release.shift()!();
        await new Promise((r) => setTimeout(r, 0));
      },
    };
  }

  beforeEach(() => {
    resolvedMode = 'embedded';
  });
  afterEach(() => {
    resolvedMode = 'remote';
    setTransport(null);
  });

  test('serves the NEWEST request first — the page just mounted, not the ones swiped past', async () => {
    const t = controllableTransport();
    // Four more than the queue will run at once, so the tail has to wait and its order is visible.
    const urls = ['/q/a', '/q/b', '/q/c', '/q/d', '/q/e', '/q/f', '/q/g'];
    const all = urls.map((u) => resolveAssetSourceCached(u).catch(() => null));

    // The first few go out as they arrive (nothing to choose between yet); what matters is who is
    // picked NEXT, and that is the last one asked for rather than the next one in arrival order.
    const firstBatch = t.started.length;
    expect(firstBatch).toBeGreaterThan(0);
    await t.drain();
    expect(t.started[firstBatch]).toBe('/q/g');

    await t.drain();
    await t.drain();
    await t.drain();
    await Promise.all(all);
  });

  test('a warm-ahead never goes before a page that has mounted', async () => {
    const t = controllableTransport();
    // Fill every slot so the next pick is a real choice between what is waiting.
    const blocking = ['/w/block1', '/w/block2', '/w/block3'].map((u) => resolveAssetSourceCached(u).catch(() => null));
    const warm = ['/w/warm1', '/w/warm2'].map((u) => resolveAssetSourceCached(u, { background: true }).catch(() => null));
    // Asked for LAST, so newest-first would have taken a warm — the tier is what decides here.
    const page = resolveAssetSourceCached('/w/page').catch(() => null);

    await t.drain();
    expect(t.started[3]).toBe('/w/page');

    await t.drain();
    await t.drain();
    await Promise.all([...blocking, ...warm, page]);
  });

  test('re-asking for a queued path moves it to the head, warm or not', async () => {
    const t = controllableTransport();
    const blocking = ['/b/block1', '/b/block2', '/b/block3'].map((u) => resolveAssetSourceCached(u).catch(() => null));
    const warm = resolveAssetSourceCached('/b/target', { background: true }).catch(() => null);
    const others = ['/b/other1', '/b/other2'].map((u) => resolveAssetSourceCached(u).catch(() => null));

    // The reader lands on the page a warm had already queued. It must not inherit the warm's place
    // in line from when the guess was made — this is the bump that lets it overtake.
    const landed = resolveAssetSourceCached('/b/target').catch(() => null);

    await t.drain();
    expect(t.started[3]).toBe('/b/target');

    await t.drain();
    await t.drain();
    await Promise.all([...blocking, warm, ...others, landed]);
  });

  test('a page swiped past is dropped from the queue, not fetched anyway', async () => {
    const t = controllableTransport();
    const blocking = ['/r/block1', '/r/block2', '/r/block3'].map((u) => resolveAssetSourceCached(u).catch(() => null));
    // Two pages mount as the swipe crosses them, then unmount again behind it.
    const passed = ['/r/passed1', '/r/passed2'].map((u) => resolveAssetSourceCached(u).catch(() => null));
    const landed = resolveAssetSourceCached('/r/landed').catch(() => null);

    releaseAssetResolve('/r/passed1');
    releaseAssetResolve('/r/passed2');
    expect(assetResolvesInFlight()).toBe(4); // the three running, plus the page actually being read

    await t.drain();
    await t.drain();
    await Promise.all([...blocking, ...passed, landed]);
    expect(t.started).not.toContain('/r/passed1');
    expect(t.started).not.toContain('/r/passed2');
    expect(t.started).toContain('/r/landed');
  });

  test('a page still wanted elsewhere survives one of its claims being given back', async () => {
    const t = controllableTransport();
    const blocking = ['/c/block1', '/c/block2', '/c/block3'].map((u) => resolveAssetSourceCached(u).catch(() => null));
    // The same page mounted twice — which the reader really does, remounting cells as a swipe
    // passes. One instance going away must not cancel the other's page.
    const first = resolveAssetSourceCached('/c/shared').catch(() => null);
    const second = resolveAssetSourceCached('/c/shared').catch(() => null);

    releaseAssetResolve('/c/shared');

    await t.drain();
    await t.drain();
    await Promise.all([...blocking, first, second]);
    expect(t.started).toContain('/c/shared');
  });

  test('a newer warm window retires the one it replaced, but never a claimed page', async () => {
    const t = controllableTransport();
    const blocking = ['/s/block1', '/s/block2', '/s/block3'].map((u) => resolveAssetSourceCached(u).catch(() => null));
    const old = ['/s/old1', '/s/old2'].map((u) => resolveAssetSourceCached(u, { background: true }).catch(() => null));
    // Warmed as a guess, then actually mounted — no longer a guess, whatever queued it first.
    const promoted = resolveAssetSourceCached('/s/promoted', { background: true }).catch(() => null);
    void resolveAssetSourceCached('/s/promoted').catch(() => null);

    supersedeBackgroundResolves(new Set(['/s/new1']));
    const fresh = resolveAssetSourceCached('/s/new1', { background: true }).catch(() => null);

    await t.drain();
    await t.drain();
    await Promise.all([...blocking, ...old, promoted, fresh]);
    expect(t.started).not.toContain('/s/old1');
    expect(t.started).not.toContain('/s/old2');
    expect(t.started).toContain('/s/promoted');
    expect(t.started).toContain('/s/new1');
  });

  test('invalidating a QUEUED path settles it instead of stranding whoever awaits it', async () => {
    const t = controllableTransport();
    const blocking = ['/i/block1', '/i/block2', '/i/block3'].map((u) => resolveAssetSourceCached(u).catch(() => null));
    const waiting = resolveAssetSourceCached('/i/stuck');

    // A retry busts the cache entry while the request is still queued. Before the queue had a
    // cancel, the entry was simply dropped and this promise never settled — a page that waits
    // forever, which is the exact failure the queue exists to end.
    invalidateAssetSource('/i/stuck');
    await expect(waiting).rejects.toThrow();
    expect(assetResolvesInFlight()).toBe(3);

    await t.drain();
    await Promise.all(blocking);
  });
});
