/**
 * Real end-to-end encryption for the sync payload — the concrete `CryptoBox` the design's crypto
 * seam (crypto.ts) reserved. Uses only WebCrypto (`crypto.subtle`), available on every target: Bun
 * and browsers natively, React Native via host-rn's Hermes WebCrypto shim.
 *
 * Two-level key hierarchy (docs/CROSS-DEVICE-SYNC.md → "Trust & security"):
 *   - a random **DEK** (AES-GCM-256) actually encrypts the records;
 *   - a **pairing secret** is stretched (PBKDF2-HMAC-SHA256) into a *wrapping* key that only
 *     encrypts the DEK.
 * This buys account-level rotation for free: regenerate the DEK, re-wrap it, and anything holding
 * only the old wrapping key is locked out of future data — without a device registry. Per-device
 * wrapping (wrap the DEK once per device key) is a later drop-in; the record/blob format is unchanged.
 *
 * NOTE: PBKDF2 is the strongest KDF in WebCrypto proper. Argon2id is preferred and should replace
 * `deriveWrappingKey` once a vetted RN-compatible implementation is wired in — the rest is unaffected.
 */
import type { CryptoBox } from './crypto';
import type { SyncRecord } from '@comical/sync';

const IV_BYTES = 12;
const PBKDF2_ITERS = 210_000; // OWASP 2023 baseline for PBKDF2-HMAC-SHA256
const subtle = () => crypto.subtle;
/** Narrow a Uint8Array to BufferSource (sidesteps the lib.dom ArrayBuffer/SharedArrayBuffer variance). */
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

// ── portable byte/text/base64 helpers (no atob/btoa; works under Hermes) ────────
const utf8 = new TextEncoder();
const utf8d = new TextDecoder();
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = i + 1 < bytes.length ? bytes[i + 1]! : 0, c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '=';
    out += i + 2 < bytes.length ? B64[c & 63]! : '=';
  }
  return out;
}
function b64decode(str: string): Uint8Array {
  const clean = str.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0, acc = 0, o = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out;
}

// ── key management ──────────────────────────────────────────────────────────────
/** Stretch the pairing secret + salt into an AES-GCM wrapping key (wraps/unwraps the DEK). */
export async function deriveWrappingKey(pairingSecret: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', utf8.encode(pairingSecret), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** A fresh random Data Encryption Key. Extractable so it can be wrapped for other devices. */
export async function generateDek(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Wrap the DEK with the pairing-derived key → an opaque blob to store on the backend. */
export async function wrapDek(dek: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapped = new Uint8Array(await subtle().wrapKey('raw', dek, wrappingKey, { name: 'AES-GCM', iv: bs(iv) }));
  return b64encode(concat(iv, wrapped));
}

/** Recover the DEK on another device from the wrapped blob + the same pairing-derived key. */
export async function unwrapDek(blob: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const buf = b64decode(blob);
  const iv = buf.subarray(0, IV_BYTES);
  const wrapped = buf.subarray(IV_BYTES);
  return subtle().unwrapKey('raw', bs(wrapped), wrappingKey, { name: 'AES-GCM', iv: bs(iv) }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** A public account id derived from the pairing secret, so paired devices target the same partition. */
export async function deriveAccountId(pairingSecret: string, salt: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', bs(concat(salt, utf8.encode(`account:${pairingSecret}`)))));
  return b64encode(digest.subarray(0, 16)).replace(/[+/=]/g, '');
}

// ── the CryptoBox ─────────────────────────────────────────────────────────────
/** AES-GCM box over a DEK: seals records to `base64(iv | ciphertext)`, opens the reverse. */
export function createAesGcmBox(dek: CryptoKey): CryptoBox {
  return {
    async seal(records: SyncRecord[]): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const pt = utf8.encode(JSON.stringify(records));
      const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: bs(iv) }, dek, bs(pt)));
      return b64encode(concat(iv, ct));
    },
    async open(blob: string): Promise<SyncRecord[]> {
      const buf = b64decode(blob);
      const iv = buf.subarray(0, IV_BYTES);
      const ct = buf.subarray(IV_BYTES);
      const pt = await subtle().decrypt({ name: 'AES-GCM', iv: bs(iv) }, dek, bs(ct));
      return JSON.parse(utf8d.decode(pt)) as SyncRecord[];
    },
  };
}
