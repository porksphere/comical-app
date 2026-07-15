/**
 * Tier-1 HTTP backend tests over REAL HTTP: a Bun.serve reference server implements the endpoint
 * contract (delegating to a per-account MemoryBackend — the same CRDT merge), and two devices' sync
 * engines drive it through `httpSyncBackend`. Proves convergence + offline catch-up over the wire,
 * account isolation, and that a bad token throws (leaving the outbox queued).
 *
 * The reference server here is also the executable spec for the endpoints `@comical/host-server`
 * must add.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { Clock, Replica, MemoryBackend, SyncEngine, MemoryCursor, type SyncRecord } from '@comical/sync';
import { httpSyncBackend } from './http-backend';

// ── Reference server: the contract host-server must implement ───────────────────
const accounts = new Map<string, MemoryBackend>();
const backendFor = (account: string): MemoryBackend => {
  let b = accounts.get(account);
  if (!b) accounts.set(account, (b = new MemoryBackend()));
  return b;
};
const REQUIRED_TOKEN = 'secret-token';

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('Authorization') !== `Bearer ${REQUIRED_TOKEN}`) {
      return new Response('unauthorized', { status: 401 });
    }
    const account = req.headers.get('X-Comical-Account');
    if (!account) return new Response('no account', { status: 400 });
    const backend = backendFor(account);

    if (req.method === 'POST' && url.pathname === '/sync/push') {
      await backend.push((await req.json()) as SyncRecord[]);
      return new Response(null, { status: 200 });
    }
    if (req.method === 'GET' && url.pathname === '/sync/pull') {
      const result = await backend.pull(url.searchParams.get('cursor') || null);
      return Response.json(result);
    }
    return new Response('not found', { status: 404 });
  },
});
const baseUrl = `http://localhost:${server.port}`;
afterAll(() => server.stop(true));

const time = { t: 1000 };
function device(node: string, account: string, token = REQUIRED_TOKEN) {
  const replica = new Replica(new Clock(node, () => time.t));
  const backend = httpSyncBackend({ baseUrl, account, token });
  const engine = new SyncEngine(replica, backend, new MemoryCursor());
  return { replica, engine };
}

describe('httpSyncBackend (real HTTP)', () => {
  test('two devices converge over the wire', async () => {
    const A = device('A', 'acct-converge');
    const B = device('B', 'acct-converge');
    time.t = 1000; A.replica.putRegister('entries', 'e1', { title: 'One' });
    A.replica.putProgress('e1 c1', { read: false, lastPage: 12, pageCount: 20, number: 3 });
    await A.engine.sync();
    await B.engine.sync();
    expect(B.replica.liveIds('entries')).toEqual(['e1']);
    expect(B.replica.progress('e1 c1')?.lastPage).toBe(12);
  });

  test('a device offline during others’ edits catches up on reconnect', async () => {
    const A = device('A', 'acct-offline');
    const B = device('B', 'acct-offline');
    time.t = 1000; A.replica.putRegister('entries', 'e1', { title: 'One' });
    await A.engine.sync(); // B offline
    time.t = 1100; A.replica.putRegister('entries', 'e2', { title: 'Two' });
    await A.engine.sync();
    await B.engine.sync(); // first contact — pulls both
    expect(B.replica.liveIds('entries').sort()).toEqual(['e1', 'e2']);
  });

  test('accounts are isolated', async () => {
    const A = device('A', 'acct-x');
    const other = device('Z', 'acct-y');
    time.t = 1000; A.replica.putRegister('entries', 'secret', { title: 'x-only' });
    await A.engine.sync();
    await other.engine.sync();
    expect(other.replica.liveIds('entries')).toEqual([]); // never sees acct-x's data
  });

  test('a bad token throws and leaves the outbox queued for retry', async () => {
    const bad = device('A', 'acct-auth', 'wrong-token');
    time.t = 1000; bad.replica.putRegister('entries', 'e1', { title: 'One' });
    expect(bad.replica.outbox()).toHaveLength(1);
    await expect(bad.engine.sync()).rejects.toThrow();
    expect(bad.replica.outbox()).toHaveLength(1); // NOT cleared — will retry next time
  });
});
