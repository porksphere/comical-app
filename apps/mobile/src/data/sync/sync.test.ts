/**
 * Phase-1 sync core tests. Run with `bun test src/data/sync` from apps/mobile. Pure — no RN,
 * storage, or network. The load-bearing case is "monotonic progress never rolls back," end-to-end
 * through the engine; the rest lock the CRDT laws (convergence, idempotence, tombstones) the whole
 * design rests on.
 */
import { describe, expect, test } from 'bun:test';
import { Clock, comparePacked, mergeEnvelope, Replica, MemoryBackend, SyncEngine, MemoryCursor, type Envelope, type Progress, type SyncRecord } from '@comical/sync';

import { plaintextBox, encryptedBackend, type BlobBackend } from './crypto';

// A shared, test-controlled wall clock so HLC ordering is deterministic.
function harness() {
  const time = { t: 1000 };
  const clock = (node: string) => new Clock(node, () => time.t);
  const replica = (node: string) => new Replica(clock(node));
  return { time, replica };
}
const prog = (o: Partial<Omit<Progress, 'kind' | 'hlc'>> = {}): Omit<Progress, 'kind' | 'hlc'> => ({
  read: false,
  lastPage: 0,
  pageCount: 20,
  number: 1,
  ...o,
});
const sortRecords = (rs: SyncRecord[]) =>
  [...rs].sort((a, b) => (a.table + a.id).localeCompare(b.table + b.id));

describe('HLC', () => {
  test('local stamps are strictly monotonic even within one wall-clock tick', () => {
    const time = { t: 1000 };
    const c = new Clock('A', () => time.t);
    const a = c.send();
    const b = c.send(); // same wall time → counter increments
    time.t = 1001;
    const d = c.send();
    expect(comparePacked(a, b)).toBe(-1);
    expect(comparePacked(b, d)).toBe(-1);
  });

  test('recv advances the clock so a later local write sorts after a remote one', () => {
    const time = { t: 1000 };
    const local = new Clock('A', () => time.t);
    const remote = new Clock('B', () => 9000).send(); // remote is way ahead
    local.recv(remote);
    const next = local.send();
    expect(comparePacked(next, remote)).toBe(1);
  });
});

describe('merge primitives', () => {
  test('register: later HLC wins; tombstone beats an earlier edit', () => {
    const edit: Envelope = { kind: 'register', hlc: '000000000001500:000000:A', value: { t: 'x' }, deleted: false };
    const remove: Envelope = { kind: 'register', hlc: '000000000002000:000000:B', value: null, deleted: true };
    expect(mergeEnvelope(edit, remove)).toBe(remove);
    expect(mergeEnvelope(remove, edit)).toBe(remove); // commutative
  });

  test('progress: monotonic — furthest wins regardless of which HLC is later', () => {
    const far: Envelope = { kind: 'progress', hlc: '000000000001000:000000:A', read: false, lastPage: 10, pageCount: 20, number: 5 };
    const nearButLater: Envelope = { kind: 'progress', hlc: '000000000005000:000000:B', read: false, lastPage: 3, pageCount: 20, number: 5 };
    const m = mergeEnvelope(far, nearButLater) as Progress;
    expect(m.lastPage).toBe(10); // NOT rolled back to the later write's 3
    expect(comparePacked(m.hlc, nearButLater.hlc)).toBe(0); // watermark keeps the later stamp
    // commutative
    expect((mergeEnvelope(nearButLater, far) as Progress).lastPage).toBe(10);
  });

  test('refuses to merge mismatched kinds (identity collision)', () => {
    const reg: Envelope = { kind: 'register', hlc: 'x', value: 1, deleted: false };
    const set: Envelope = { kind: 'set', hlc: 'y', present: true };
    expect(() => mergeEnvelope(reg, set)).toThrow();
  });
});

describe('Replica', () => {
  test('local writes fill the outbox; merges do not', () => {
    const { replica } = harness();
    const A = replica('A');
    A.putRegister('entries', 'e1', { title: 'One' });
    expect(A.outbox()).toHaveLength(1);
    A.clearOutbox();
    A.merge([{ table: 'entries', id: 'e2', env: { kind: 'register', hlc: '000000000009000:000000:Z', value: { title: 'Two' }, deleted: false } }]);
    expect(A.outbox()).toHaveLength(0); // merged remote change is NOT re-queued for push
    expect(A.registerValue('entries', 'e2')).toEqual({ title: 'Two' });
  });

  test('tombstone hides an entry from liveIds', () => {
    const { replica } = harness();
    const A = replica('A');
    A.putRegister('entries', 'e1', { title: 'One' });
    expect(A.liveIds('entries')).toEqual(['e1']);
    A.deleteRegister('entries', 'e1');
    expect(A.liveIds('entries')).toEqual([]);
  });

  test('a local re-read of an earlier page never rewinds progress', () => {
    const { time, replica } = harness();
    const A = replica('A');
    time.t = 1000; A.putProgress('e1 c1', prog({ number: 5, lastPage: 10 }));
    time.t = 2000; A.putProgress('e1 c1', prog({ number: 5, lastPage: 3 }));
    expect(A.progress('e1 c1')?.lastPage).toBe(10);
  });

  test('rejects a write whose strategy does not match the table', () => {
    const { replica } = harness();
    const A = replica('A');
    expect(() => A.putRegister('registries', 'r', {})).toThrow(); // registries is a set table
    expect(() => A.putSet('entries', 'e', true)).toThrow(); // entries is a register table
  });
});

describe('SyncEngine end-to-end (via MemoryBackend)', () => {
  const engineFor = (r: Replica, backend: MemoryBackend) => new SyncEngine(r, backend, new MemoryCursor());

  test('two devices converge on library membership and a removal', async () => {
    const { time, replica } = harness();
    const backend = new MemoryBackend();
    const A = replica('A'); const B = replica('B');
    const ea = engineFor(A, backend); const eb = engineFor(B, backend);

    time.t = 1000; A.putRegister('entries', 'e1', { title: 'One' });
    await ea.sync(); await eb.sync();
    expect(B.liveIds('entries')).toEqual(['e1']);

    time.t = 2000; B.deleteRegister('entries', 'e1'); // B removes it later
    await eb.sync(); await ea.sync();
    expect(A.liveIds('entries')).toEqual([]);
    expect(B.liveIds('entries')).toEqual([]);
  });

  test('CONCURRENT stale progress write does not roll read position back', async () => {
    const { time, replica } = harness();
    const backend = new MemoryBackend();
    const A = replica('A'); const B = replica('B');
    const ea = engineFor(A, backend); const eb = engineFor(B, backend);

    // Genuinely concurrent: neither device has seen the other's write yet.
    time.t = 1000; A.putProgress('e1 c1', prog({ number: 5, lastPage: 10 })); // A reads to page 10
    time.t = 1001; B.putProgress('e1 c1', prog({ number: 5, lastPage: 3 })); // B, offline, only to page 3 (LATER hlc)

    await ea.sync(); await eb.sync(); await ea.sync(); // exchange through the backend
    expect(A.progress('e1 c1')?.lastPage).toBe(10);
    expect(B.progress('e1 c1')?.lastPage).toBe(10); // furthest-read wins despite B's later write
  });

  test('a device offline for a while catches up, and its offline edits propagate', async () => {
    const { time, replica } = harness();
    const backend = new MemoryBackend();
    const A = replica('A'); const B = replica('B'); const C = replica('C');
    const ea = engineFor(A, backend); const eb = engineFor(B, backend); const ec = engineFor(C, backend);

    time.t = 1000; A.putRegister('entries', 'e1', { title: 'One' });
    await ea.sync(); await ec.sync(); // A and C exchange; B is offline

    time.t = 1500; B.putRegister('entries', 'e2', { title: 'Two (made offline)' }); // B edits while offline
    time.t = 2000; C.putSet('registries', 'https://r1', true, { name: 'R1' });
    await ec.sync(); // C's registry hits the backend while B is still offline

    // B reconnects for the first time in a while.
    await eb.sync();
    expect(B.liveIds('entries').sort()).toEqual(['e1', 'e2']); // caught up on A's e1…
    expect(B.liveIds('registries')).toEqual(['https://r1']); // …and C's registry

    // B's offline edit reaches the others on their next sync.
    await ea.sync();
    expect(A.registerValue('entries', 'e2')).toEqual({ title: 'Two (made offline)' });
  });

  test('cursor advances so a second sync with no changes pulls nothing', async () => {
    const { time, replica } = harness();
    const backend = new MemoryBackend();
    const A = replica('A'); const B = replica('B');
    const ea = engineFor(A, backend); const eb = engineFor(B, backend);
    time.t = 1000; A.putRegister('entries', 'e1', { title: 'One' });
    await ea.sync();
    const first = await eb.sync();
    const second = await eb.sync();
    expect(first.pulled).toBeGreaterThan(0);
    expect(second.pulled).toBe(0); // nothing new since the cursor
  });
});

describe('convergence law', () => {
  test('merging the same records in different orders yields identical state', () => {
    const { time, replica } = harness();
    const src = replica('A');
    time.t = 1000; src.putRegister('entries', 'e1', { title: 'One' });
    time.t = 1001; src.putSet('registries', 'https://r1', true, { name: 'R1' });
    time.t = 1002; src.putProgress('e1 c1', prog({ number: 2, lastPage: 7 }));
    time.t = 1003; src.deleteRegister('entries', 'e1');
    const records = src.all();

    const forward = replica('X'); forward.merge(records);
    const reversed = replica('Y'); reversed.merge([...records].reverse());
    expect(sortRecords(forward.all())).toEqual(sortRecords(reversed.all()));

    // idempotent: merging twice changes nothing
    const twice = replica('Z'); twice.merge(records); twice.merge(records);
    expect(sortRecords(twice.all())).toEqual(sortRecords(forward.all()));
  });
});

describe('E2E crypto seam', () => {
  test('plaintext box round-trips records', async () => {
    const recs: SyncRecord[] = [{ table: 'entries', id: 'e1', env: { kind: 'register', hlc: 'h', value: { title: 'One' }, deleted: false } }];
    expect(await plaintextBox.open(await plaintextBox.seal(recs))).toEqual(recs);
  });

  test('encryptedBackend over an opaque blob store still converges two replicas', async () => {
    // A minimal append-only blob store — the Tier-2 substrate, seen only as opaque strings here.
    const blobs: string[] = [];
    const blobBackend: BlobBackend = {
      async putBlob(b) { blobs.push(b); },
      async getBlobs(cursor) {
        const from = cursor ? Number(cursor) : 0;
        return { blobs: blobs.slice(from), cursor: String(blobs.length) };
      },
    };
    const backend = encryptedBackend(blobBackend, plaintextBox); // plaintext stands in for the real box
    const { time, replica } = harness();
    const A = replica('A'); const B = replica('B');
    const ea = new SyncEngine(A, backend, new MemoryCursor());
    const eb = new SyncEngine(B, backend, new MemoryCursor());
    time.t = 1000; A.putRegister('entries', 'e1', { title: 'Sealed' });
    await ea.sync(); await eb.sync();
    expect(B.registerValue('entries', 'e1')).toEqual({ title: 'Sealed' });
  });
});
