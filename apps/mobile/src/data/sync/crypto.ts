/**
 * The end-to-end encryption seam. A publicly-exposed rendezvous (or a third-party blob) must not be
 * trusted with library contents, so records are sealed client-side before they reach a backend and
 * opened after they're pulled. This file defines the seam and a pass-through implementation; the
 * real crypto (a random Data Encryption Key wrapped by a pairing-secret-derived key, with
 * account-level rotation) lands in phase 3 — see the "Trust & security" section of
 * docs/CROSS-DEVICE-SYNC.md. Designing the seam now keeps the DEK indirection (and later per-device
 * wrapping) a drop-in, with no change to the record/protocol format.
 */
import type { PullResult, SyncBackend, SyncRecord } from '@comical/sync';

export interface CryptoBox {
  /** Serialise + encrypt a batch of records into an opaque blob for the backend. */
  seal(records: SyncRecord[]): Promise<string>;
  /** Decrypt + parse a blob pulled from the backend. */
  open(blob: string): Promise<SyncRecord[]>;
}

/** No-op box: JSON only, no encryption. For local/trusted backends and tests ONLY. */
export const plaintextBox: CryptoBox = {
  async seal(records) {
    return JSON.stringify(records);
  },
  async open(blob) {
    return JSON.parse(blob) as SyncRecord[];
  },
};

/**
 * Wraps a *blob* backend so the engine can treat it as a record backend while everything on the wire
 * is sealed. A record-native backend (like the hub, which merges server-side) can't be wrapped this
 * way without the server holding the key — for those, E2E means the client pulls-merges-pushes and
 * the server stores one opaque blob per account. Both shapes reuse this same CryptoBox.
 */
export function encryptedBackend(inner: BlobBackend, box: CryptoBox): SyncBackend {
  return {
    async push(records) {
      await inner.putBlob(await box.seal(records));
    },
    async pull(cursor): Promise<PullResult> {
      const { blobs, cursor: next } = await inner.getBlobs(cursor);
      const records = (await Promise.all(blobs.map((b) => box.open(b)))).flat();
      return { records, cursor: next };
    },
  };
}

/** A backend that stores opaque append-only blobs (WebDAV/S3/Drive) — the Tier-2 substrate. */
export interface BlobBackend {
  putBlob(blob: string): Promise<void>;
  getBlobs(cursor: string | null): Promise<{ blobs: string[]; cursor: string | null }>;
}
