/**
 * End-to-end proof of the embedded transport, run under Bun.
 *
 * It wires the REAL `@comical/host-server` `createRouter` (imported from the sibling `comical` repo)
 * to the `EmbeddedBridgeProvider`, backed by a fake `NativeBridgeRuntime` that runs a real bridge
 * bundle through `@comical/core`'s `loadBridge` + `NodeVmEvaluator` — the same node:vm stand-in for
 * the on-device JSC/QuickJS engine that host-native's own tests use. So this exercises the exact
 * production path (path → router.fetch → proxy provider → native engine → bridge method → JSON),
 * differing only in the JS engine that runs the bundle.
 *
 * Excluded from the app's `tsc` (it imports node-typed sibling source); `bun test` runs it.
 */
import { afterEach, describe, expect, test } from 'bun:test';
// Sibling comical repo (runtime imports — resolved by bun, never bundled into the app):
import { loadBridge, type LoadedBridge } from '../../../../../../comical/packages/core/src/loader.ts';
import { NodeVmEvaluator } from '../../../../../../comical/packages/core/src/sandbox.ts';
import { createRouter } from '../../../../../../comical/packages/host-server/src/router.ts';
import { getBridges, searchBridge, setTransport } from '../api';
import { EmbeddedBridgeProvider } from './provider';
import { createEmbeddedTransport } from './transport';
import type { BundleSource, CreateRouter, InstalledBridge, NativeBridgeRuntime, SettingsStore } from './types';

// Note: ./index, ./native-runtime, and ./settings-store are deliberately NOT imported here — they
// eagerly pull `expo` / AsyncStorage (RN-only) which don't load under bare Bun. This test drives the
// transport directly and wires api.ts via its exported `setTransport`, covering the same path
// `installEmbeddedTransport` takes. The install wiring itself is covered by `tsc`.

// A minimal in-memory HostCapabilities for loadBridge (the demo bridge does no network I/O).
function makeHost(settings: Record<string, unknown>): unknown {
  const store = new Map<string, string>();
  return {
    network: { request: async () => ({ url: 'x', status: 200, statusText: 'OK', headers: {}, body: '{}' }) },
    storage: {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: string) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
      keys: async () => [...store.keys()],
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings,
  };
}

const BRIDGE_INFO = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  contractVersion: '1.0.0',
  languages: ['en'],
  nsfw: false,
  capabilities: ['lists', 'search'],
};
// A real CJS bridge bundle, the shape `bun build --format=cjs` emits.
const DEMO_BUNDLE = `module.exports = { default: (host) => ({
  info: ${JSON.stringify(BRIDGE_INFO)},
  getLists: async () => [{ id: "home", name: "Home" }],
  getListItems: async (listId, page) => ({ items: [{ id: "a", title: "A" }], page, hasNextPage: false }),
  getSearchResults: async (q, page) => ({ items: [{ id: "hit", title: "Result for " + q }], page, hasNextPage: false }),
  getSeriesDetails: async (id) => ({ id, title: "Series " + id }),
  getChapters: async () => [{ id: "c1", name: "Chapter 1", number: 1 }],
  getChapterPages: async () => [{ index: 0, imageUrl: "https://cdn/p0.webp" }],
}) };`;

/** Fake native module: loadBridge under NodeVmEvaluator, exactly like host-native's runtime test. */
function makeFakeNative(): NativeBridgeRuntime {
  const evaluator = new NodeVmEvaluator();
  const contexts = new Map<string, LoadedBridge>();
  return {
    async initBridge(id, code, settingsJson) {
      const settings = JSON.parse(settingsJson) as Record<string, unknown>;
      const bridge = loadBridge({ code, capabilities: makeHost(settings) as never, evaluator });
      contexts.set(id, bridge);
      const methods = Object.keys(bridge).filter(
        (k) => typeof (bridge as Record<string, unknown>)[k] === 'function',
      );
      return JSON.stringify({ info: bridge.info, methods });
    },
    async callBridge(id, method, argsJson) {
      const bridge = contexts.get(id);
      if (!bridge) throw new Error(`bridge not initialised: ${id}`);
      const args = JSON.parse(argsJson) as unknown[];
      const fn = (bridge as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
      return JSON.stringify(await fn(...args));
    },
    disposeBridge(id) {
      contexts.delete(id);
    },
  };
}

const installed: InstalledBridge[] = [{ info: BRIDGE_INFO as never, settings: [], source: 'registry' }];
const bundles: BundleSource = {
  installed: async () => installed,
  resolveBundle: async (id) => {
    if (id !== 'demo') throw new Error(`bridge not found: ${id}`);
    return DEMO_BUNDLE;
  },
};
function memorySettings(): SettingsStore {
  const map = new Map<string, Record<string, never>>();
  return { get: async (id) => map.get(id) ?? {}, set: async (id, v) => void map.set(id, v as Record<string, never>) };
}

function makeProvider(): EmbeddedBridgeProvider {
  return new EmbeddedBridgeProvider({ native: makeFakeNative(), bundles, settings: memorySettings() });
}

afterEach(() => {
  setTransport(null);
});

describe('embedded transport (real router + core, node:vm engine stand-in)', () => {
  test('GET /bridges lists the on-device bridge as configured', async () => {
    const transport = createEmbeddedTransport(makeProvider(), createRouter as unknown as CreateRouter);
    const res = await transport('/bridges');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { info: { id: string }; configured: boolean }[];
    expect(body[0]?.info.id).toBe('demo');
    expect(body[0]?.configured).toBe(true);
  });

  test('search runs the bundle on-device and returns contract-shaped results', async () => {
    const transport = createEmbeddedTransport(makeProvider(), createRouter as unknown as CreateRouter);
    const res = await transport('/bridges/demo/search?q=naruto&page=1');
    const body = (await res.json()) as { items: { title: string }[] };
    expect(body.items[0]?.title).toBe('Result for naruto');
  });

  test('series detail → chapters → chapter pages', async () => {
    const transport = createEmbeddedTransport(makeProvider(), createRouter as unknown as CreateRouter);
    expect(((await (await transport('/bridges/demo/series/s1')).json()) as { id: string }).id).toBe('s1');
    const chapters = (await (await transport('/bridges/demo/series/s1/chapters')).json()) as { id: string }[];
    expect(chapters[0]?.id).toBe('c1');
    const pages = (await (await transport('/bridges/demo/series/s1/chapters/c1/pages')).json()) as unknown[];
    expect(pages).toHaveLength(1);
  });

  test('unknown bridge → 404', async () => {
    const transport = createEmbeddedTransport(makeProvider(), createRouter as unknown as CreateRouter);
    expect((await transport('/bridges/nope/lists')).status).toBe(404);
  });

  test('wired into api.ts: public getBridges/searchBridge resolve on-device (no server)', async () => {
    setTransport(createEmbeddedTransport(makeProvider(), createRouter as unknown as CreateRouter));
    // These public api.ts functions now go through the embedded transport — no server involved.
    const list = await getBridges();
    expect(list.map((b) => b.id)).toEqual(['demo']);
    const results = await searchBridge('demo', 'onepiece', 1);
    expect(results.items[0]?.title).toBe('Result for onepiece');
  });
});
