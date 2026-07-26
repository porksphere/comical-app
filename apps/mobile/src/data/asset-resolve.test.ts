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
import { describe, expect, mock, test } from 'bun:test';

// `api.ts` reaches react-native through its persisted-observable/diagnostics helpers, which bun
// can't parse (Flow-typed `react-native/index.js`). Only the resolver is under test here, and it
// needs nothing from those beyond `getApiBase`'s backing store — so stub them, exactly as
// `downloads/engine.test.ts` stubs its own heavy imports.
mock.module('@/lib/observable', () => ({
  persisted$: () => ({ url: null, get: () => ({ url: null }), peek: () => ({ url: null }), set: () => {} }),
  migrateLegacyKey: () => {},
}));
mock.module('@/lib/diagnostics', () => ({ logDiagnostic: () => {} }));
mock.module('@legendapp/state/react', () => ({ use$: (o: unknown) => o }));
mock.module('./embedded/preference', () => ({ getResolvedModeSync: () => 'remote' }));

const { invalidateAssetSource, peekResolvedAssetSource, resolveAssetSourceCached } = await import('./api');

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
