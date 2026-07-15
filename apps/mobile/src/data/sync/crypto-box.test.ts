/**
 * Real E2E crypto tests (WebCrypto under bun). Proves: records round-trip; the sealed blob leaks no
 * plaintext; two devices that share a pairing secret independently recover the same DEK and read each
 * other's data; account-level rotation locks out the old key; and the whole thing composes with the
 * engine so two devices converge with only ciphertext on the wire.
 */
import { describe, expect, test } from 'bun:test';
import { Clock, Replica, SyncEngine, MemoryCursor, type SyncRecord } from '@comical/sync';
import { encryptedBackend, type BlobBackend } from './crypto';
import { createAesGcmBox, deriveWrappingKey, generateDek, wrapDek, unwrapDek, deriveAccountId } from './crypto-box';

const records: SyncRecord[] = [
  { table: 'entries', id: 'md:s1', env: { kind: 'register', hlc: '000000000001000:000000:A', value: { title: 'A Secret Manga' }, deleted: false } },
];
const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

describe('crypto-box', () => {
  test('seals and opens records; the blob leaks no plaintext', async () => {
    const box = createAesGcmBox(await generateDek());
    const blob = await box.seal(records);
    expect(blob).not.toContain('Secret'); // ciphertext, not JSON
    expect(await box.open(blob)).toEqual(records);
  });

  test('two devices sharing a pairing secret recover the same DEK', async () => {
    // Device A: generate a DEK, wrap it with the pairing-derived key.
    const wkA = await deriveWrappingKey('correct horse battery staple', salt);
    const dek = await generateDek();
    const wrapped = await wrapDek(dek, wkA);
    const blob = await createAesGcmBox(dek).seal(records);

    // Device B: same secret → same wrapping key → unwrap the DEK → open A's blob.
    const wkB = await deriveWrappingKey('correct horse battery staple', salt);
    const dekB = await unwrapDek(wrapped, wkB);
    expect(await createAesGcmBox(dekB).open(blob)).toEqual(records);
  });

  test('a wrong pairing secret cannot unwrap the DEK', async () => {
    const dek = await generateDek();
    const wrapped = await wrapDek(dek, await deriveWrappingKey('right', salt));
    await expect(unwrapDek(wrapped, await deriveWrappingKey('wrong', salt))).rejects.toThrow();
  });

  test('account-level rotation: a new DEK cannot open the old blob', async () => {
    const oldBlob = await createAesGcmBox(await generateDek()).seal(records);
    const rotated = createAesGcmBox(await generateDek());
    await expect(rotated.open(oldBlob)).rejects.toThrow();
  });

  test('paired devices derive the same public account id', async () => {
    const a = await deriveAccountId('shared-secret', salt);
    const b = await deriveAccountId('shared-secret', salt);
    const other = await deriveAccountId('different-secret', salt);
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).not.toContain('secret'); // it's a hash, not the secret
  });

  test('engine converges two devices with only ciphertext on the wire', async () => {
    // Shared DEK (as if both unwrapped it from the same pairing secret).
    const dek = await generateDek();
    const box = createAesGcmBox(dek);
    const rawBlobs: string[] = [];
    const blobBackend: BlobBackend = {
      async putBlob(b) { rawBlobs.push(b); },
      async getBlobs(cursor) {
        const from = cursor ? Number(cursor) : 0;
        return { blobs: rawBlobs.slice(from), cursor: String(rawBlobs.length) };
      },
    };
    const backend = encryptedBackend(blobBackend, box);
    const time = { t: 1000 };
    const A = new Replica(new Clock('A', () => time.t));
    const B = new Replica(new Clock('B', () => time.t));
    const eA = new SyncEngine(A, backend, new MemoryCursor());
    const eB = new SyncEngine(B, backend, new MemoryCursor());

    A.putRegister('entries', 'md:s1', { title: 'A Secret Manga' });
    await eA.sync();
    await eB.sync();

    expect(B.registerValue('entries', 'md:s1')).toEqual({ title: 'A Secret Manga' });
    expect(rawBlobs.join('')).not.toContain('Secret'); // nothing readable ever hit the backend
  });
});
