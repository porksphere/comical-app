/**
 * The whole chain, locally: two "phones" — each the app's own sync controller over an in-memory
 * library — against a REAL host-server (its `createServer`, with `sync: true`) over HTTP. What the
 * app does on a device minus AsyncStorage and AppState, and what the server does in `bun run dev`
 * minus the bridges. The server's own library is read through its `/library` routes, which is what
 * the browser client sees.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entryKey, InMemoryLibraryStore, Library } from '@comical/library';
import { HttpBackend } from '@comical/sync';

// Not one of the app's mapped packages: the server is the dev backend, only a test reaches it.
import { createServer } from '../../../../../external/comical/packages/host-server/src/server.ts';
import { createLibrarySync, type SyncDoc } from './controller';

type Server = ReturnType<typeof createServer>;

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) s.stop(true);
  // Stopping the listener doesn't stop a server's in-flight sync round (a real server exits with
  // the process); give it a moment before its data dir goes away under it.
  await new Promise((r) => setTimeout(r, 400));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dataDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'comical-sync-e2e-'));
  dirs.push(d);
  return d;
}

/** A host-server with a synced library, on a free port. `restart` brings it back on the same data. */
function startServer(dir = dataDir()) {
  const srv = createServer({ port: 0, bridgesDir: join(dir, 'bridges'), dataDir: dir, library: true, sync: true });
  servers.push(srv);
  const url = `http://localhost:${srv.port}`;
  const api = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(url + path, {
      method,
      ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  };
  return { srv, dir, url, api };
}

let ids = 0;

/** A phone: the app's controller over an in-memory library, pointed at whatever `url()` says now. */
function phone(url: () => string) {
  const raw = new InMemoryLibraryStore();
  let saved: SyncDoc | null = null;
  let lastError: string | undefined;
  const sync = createLibrarySync({
    raw,
    load: async () => saved,
    save: async (doc) => {
      saved = doc;
    },
    backend: () => new HttpBackend({ baseUrl: url(), fetch: (u, init) => fetch(u, init) }),
    canSync: () => true,
    newDeviceId: () => `app-${++ids}`,
    onApplied: () => {},
    onStatus: (s) => {
      lastError = s.lastError;
    },
    log: () => {},
    debounceMs: 60_000, // rounds only when a test asks, so ordering is deterministic
  });
  return { raw, sync, library: new Library(sync.store), lastError: () => lastError, saved: () => saved };
}

const collectionNames = async (lib: Library) => (await lib.getCollections()).map((c) => c.name).sort();
const seriesTitles = async (lib: Library) => (await lib.getLibrary()).map((s) => s.seriesTitle).sort();

const bridgeId = 'test-bridge';

describe('library sync, phone ↔ host-server ↔ phone', () => {
  test("a phone's additions reach the server's library and a second phone", async () => {
    const server = startServer();
    const a = phone(() => server.url);
    await a.sync.enable();
    await a.library.createCollection('Reading');
    await a.library.collectSeries({ bridgeId, seriesId: 's1' }, { seriesTitle: 'One' });
    await a.sync.syncNow();

    // The server applies a push after a short debounce, then its /library routes show it.
    await until(async () => (await server.api<unknown[]>('GET', '/library')).length === 1);
    expect((await server.api<{ name: string }[]>('GET', '/library/collections')).map((c) => c.name)).toEqual(['Reading']);

    const b = phone(() => server.url);
    await b.sync.enable();
    expect(await collectionNames(b.library)).toEqual(['Reading']);
    expect(await seriesTitles(b.library)).toEqual(['One']);
  });

  test("an edit made on the server (the browser) reaches every phone", async () => {
    const server = startServer();
    const a = phone(() => server.url);
    const b = phone(() => server.url);
    await a.sync.enable();
    await b.sync.enable();

    await server.api('POST', '/library/collections', { name: 'From the browser' });
    // The server records its own write and syncs it to the hub after its debounce.
    await until(async () => {
      await a.sync.syncNow();
      return (await collectionNames(a.library)).includes('From the browser');
    });
    await b.sync.syncNow();
    expect(await collectionNames(b.library)).toEqual(['From the browser']);
  });

  test('offline edits on both phones converge: last rename wins, progress merges', async () => {
    const server = startServer();
    const a = phone(() => server.url);
    await a.sync.enable();
    const col = await a.library.createCollection('Old name');
    await a.library.collectSeries({ bridgeId, seriesId: 's1' }, { seriesTitle: 'One' });
    await a.sync.syncNow();
    const b = phone(() => server.url);
    await b.sync.enable();

    // Both offline now. a renames, then b renames later; each reads a different chapter.
    const key = entryKey(bridgeId, 's1');
    await a.library.renameCollection(col.id, 'A name');
    await a.library.markRead(key, 'c1', true, 'Chapter 1', 1);
    await new Promise((r) => setTimeout(r, 5)); // b's rename is strictly later
    await b.library.renameCollection(col.id, 'B name');
    await b.library.markRead(key, 'c2', true, 'Chapter 2', 2);

    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow(); // a picks up b's push

    for (const p of [a, b]) {
      expect(await collectionNames(p.library)).toEqual(['B name']);
      expect((await p.library.getProgress(key)).filter((c) => c.read).map((c) => c.chapterId).sort()).toEqual(['c1', 'c2']);
    }
    await until(async () =>
      (await server.api<{ chapterId: string; read: boolean }[]>('GET', `/library/collected/series/${bridgeId}/s1/progress`))
        .filter((c) => c.read).length === 2,
    );
    expect((await server.api<{ name: string }[]>('GET', '/library/collections')).map((c) => c.name)).toEqual(['B name']);
  });

  test('a server restart keeps the log and its own device: nothing is lost or re-sent', async () => {
    let server = startServer();
    const a = phone(() => server.url);
    await a.sync.enable();
    await a.library.createCollection('Before restart');
    await a.sync.syncNow();
    await until(async () => (await server.api<unknown[]>('GET', '/library/collections')).length === 1);

    const serverDevice = () => (JSON.parse(readFileSync(join(server.dir, 'sync', 'state.json'), 'utf8')) as { device: string }).device;
    const device = serverDevice();

    server.srv.stop(true);
    server = startServer(server.dir);
    const afterRestart = server;

    // What the server holds is still there, under the same device, and it answers the phone from
    // where it left off.
    expect((await server.api<{ name: string }[]>('GET', '/library/collections')).map((c) => c.name)).toEqual(['Before restart']);
    expect(serverDevice()).toBe(device);
    await a.library.createCollection('After restart');
    await a.sync.syncNow();
    await until(async () => (await afterRestart.api<unknown[]>('GET', '/library/collections')).length === 2);

    const b = phone(() => afterRestart.url);
    await b.sync.enable();
    expect(await collectionNames(b.library)).toEqual(['After restart', 'Before restart']);
    // The hub kept the phone's two segments as one log; nothing was pushed twice.
    const hub = await new HttpBackend({ baseUrl: server.url, fetch: (u, init) => fetch(u, init) }).pull({});
    const phoneDevice = a.saved()!.state.device;
    expect(hub.segments.map((s) => [s.device, s.seq])).toEqual([[phoneDevice, 1], [phoneDevice, 2]]);
  });

  test("a hub that lost its log refuses the phone's next push, and the phone reports it", async () => {
    let server = startServer();
    const a = phone(() => server.url);
    await a.sync.enable();
    await a.library.createCollection('One');
    await a.sync.syncNow();
    await a.library.createCollection('Two');
    await a.sync.syncNow();
    await until(async () => (await server.api<unknown[]>('GET', '/library/collections')).length === 2);

    server.srv.stop(true);
    rmSync(join(server.dir, 'sync'), { recursive: true, force: true });
    server = startServer(server.dir); // a fresh hub, seeded from the server's own library

    await a.library.createCollection('Three');
    await expect(a.sync.syncNow()).resolves.toBeUndefined();
    expect(a.lastError()).toMatch(/pushed seq 3 but the log is at 0/);
    // Nothing was applied blindly: the phone still has all three, the server its own two.
    expect(await collectionNames(a.library)).toEqual(['One', 'Three', 'Two']);
    expect((await server.api<unknown[]>('GET', '/library/collections')).length).toBe(2);
  });

  test('pairing a phone that already holds a large library', async () => {
    const server = startServer();
    const a = phone(() => server.url);
    const SERIES = 400;
    const CHAPTERS = 10;
    for (let i = 0; i < SERIES; i++) {
      await a.library.collectSeries({ bridgeId, seriesId: `s${i}` }, { seriesTitle: `Series ${i}` });
      const key = entryKey(bridgeId, `s${i}`);
      for (let c = 0; c < CHAPTERS; c++) await a.library.markRead(key, `c${c}`, true, `Chapter ${c}`, c);
    }

    let t = performance.now();
    await a.sync.enable();
    const pair = performance.now() - t;
    await until(async () => (await server.api<unknown[]>('GET', '/library')).length === SERIES, 30_000);

    t = performance.now();
    const b = phone(() => server.url);
    await b.sync.enable();
    const join2 = performance.now() - t;
    expect((await b.library.getLibrary()).length).toBe(SERIES);
    expect((await b.library.getProgress(entryKey(bridgeId, 's7'))).filter((c) => c.read).length).toBe(CHAPTERS);

    const state = JSON.stringify(a.saved()).length;
    console.log(
      `sync e2e: ${SERIES} series × ${CHAPTERS} chapters — pair ${pair.toFixed(0)}ms, ` +
        `second phone ${join2.toFixed(0)}ms, saved state ${(state / 1024).toFixed(0)}KB`,
    );
  }, 60_000);
});

async function until(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}
