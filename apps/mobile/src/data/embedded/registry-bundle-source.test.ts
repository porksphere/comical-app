/**
 * RegistryBundleSource against the REAL `@comical/registry` fetcher + verify (submodule source),
 * with a mocked global `fetch` serving an index + bundle. This exercises real SHA-256 verification
 * under Bun's WebCrypto — the same `verify.ts` that runs on-device (behind a crypto.subtle polyfill).
 *
 * Excluded from the app's tsc (imports node-typed submodule source); `bun test` runs it.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { downloadBundle, fetchIndex } from '../../../../../external/comical/packages/registry/src/fetcher.ts';
import { sha256Hex } from '../../../../../external/comical/packages/registry/src/verify.ts';
import { MemoryBundleCache, RegistryBundleSource, type RegistryFetcher } from './registry-bundle-source';

const INDEX_URL = 'https://registry.example/index.json';
const BUNDLE_URL = 'https://registry.example/bridges/demo.js';
const BUNDLE = 'module.exports = { default: () => ({ info: { id: "demo" } }) };';

const fetcher: RegistryFetcher = { fetchIndex, downloadBundle };

async function makeIndex(sha256?: string) {
  const digest = sha256 ?? (await sha256Hex(new TextEncoder().encode(BUNDLE)));
  return {
    registryVersion: '1',
    updated: new Date().toISOString(),
    bridges: [
      {
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        contractVersion: '1.0.0',
        languages: ['en'],
        nsfw: false,
        capabilities: ['search'],
        url: BUNDLE_URL,
        sha256: digest,
      },
    ],
  };
}

let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;

function mockFetch(index: unknown): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchCalls.push(url);
    if (url === INDEX_URL) {
      return new Response(JSON.stringify(index), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === BUNDLE_URL) {
      return new Response(new TextEncoder().encode(BUNDLE), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('RegistryBundleSource', () => {
  test('installed() maps index entries to BridgeInfo', async () => {
    mockFetch(await makeIndex());
    const src = new RegistryBundleSource({ indexUrl: INDEX_URL, fetcher });
    const installed = await src.installed();
    expect(installed).toHaveLength(1);
    expect(installed[0]?.info.id).toBe('demo');
    expect(installed[0]?.info.capabilities).toEqual(['search']);
    expect(installed[0]?.source).toBe('registry');
  });

  test('resolveBundle downloads + verifies, then serves from cache on repeat', async () => {
    mockFetch(await makeIndex());
    const cache = new MemoryBundleCache();
    const src = new RegistryBundleSource({ indexUrl: INDEX_URL, fetcher, cache });

    const code = await src.resolveBundle('demo');
    expect(code).toBe(BUNDLE);
    expect(fetchCalls.filter((u) => u === BUNDLE_URL)).toHaveLength(1);

    // Second resolve: index already memoized + bundle cached → no further bundle fetch.
    const again = await src.resolveBundle('demo');
    expect(again).toBe(BUNDLE);
    expect(fetchCalls.filter((u) => u === BUNDLE_URL)).toHaveLength(1);
  });

  test('a tampered sha256 fails verification', async () => {
    const bad = 'f'.repeat(64); // wrong (but well-formed) digest
    mockFetch(await makeIndex(bad));
    const src = new RegistryBundleSource({ indexUrl: INDEX_URL, fetcher });
    await expect(src.resolveBundle('demo')).rejects.toThrow();
  });

  test('unknown bridge id → "not found"', async () => {
    mockFetch(await makeIndex());
    const src = new RegistryBundleSource({ indexUrl: INDEX_URL, fetcher });
    await expect(src.resolveBundle('nope')).rejects.toThrow(/not found/);
  });
});
