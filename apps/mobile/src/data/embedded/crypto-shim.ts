/**
 * Minimal `crypto.subtle` polyfill for Hermes, covering exactly what `@comical/registry`'s
 * `verify.ts` uses to verify downloaded bridge bundles: `digest("SHA-256", …)` (always) and
 * `importKey`/`verify` for Ed25519 (only when a registry signs its index). Hermes ships no WebCrypto,
 * so without this the registry `BundleSource` throws on the first bundle download.
 *
 * Backed by pure-JS `@noble/*` (no native module / extra build step). Installed from `startup.ts`
 * on native before any bundle is resolved; a no-op where `crypto.subtle.digest` already exists
 * (web, or a future native WebCrypto).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { verifyAsync } from '@noble/ed25519';

interface OpaqueKey {
  _raw: Uint8Array;
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function installWebCryptoShim(): void {
  const g = globalThis as unknown as { crypto?: { subtle?: { digest?: unknown } } };
  if (g.crypto?.subtle?.digest) return; // real WebCrypto present — leave it alone

  const subtle = {
    async digest(_algorithm: unknown, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
      const digest = sha256(toBytes(data)); // fresh 32-byte Uint8Array (offset 0)
      return digest.buffer as ArrayBuffer;
    },
    async importKey(
      _format: unknown,
      keyData: ArrayBuffer | ArrayBufferView,
      _algorithm: unknown,
      _extractable: unknown,
      _usages: unknown,
    ): Promise<OpaqueKey> {
      // Opaque handle consumed only by `verify` below (verify.ts never inspects the key otherwise).
      return { _raw: toBytes(keyData) };
    },
    async verify(
      _algorithm: unknown,
      key: OpaqueKey,
      signature: ArrayBuffer | ArrayBufferView,
      data: ArrayBuffer | ArrayBufferView,
    ): Promise<boolean> {
      return verifyAsync(toBytes(signature), toBytes(data), key._raw);
    },
  };

  const cryptoObj = (g.crypto ?? {}) as { subtle?: unknown };
  if (!cryptoObj.subtle) cryptoObj.subtle = subtle;
  g.crypto = cryptoObj as { subtle?: { digest?: unknown } };
}
