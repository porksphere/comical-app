/**
 * Persistent, on-disk bundle cache for the embedded runtime.
 *
 * host-rn's default is an in-memory `MemoryBundleCache`, so without this every cold start
 * re-downloads AND re-verifies (SHA-256 / Ed25519 through the Hermes WebCrypto shim) each installed
 * bridge's bundle before it can be evaluated in the engine — pure latency on every launch. Persisting
 * the verified bundle to disk turns the second-launch-onward path into a local file read.
 *
 * Keyed by (id, sha256): the sha256 is the bundle's content hash, so an updated bundle lands under a
 * new filename and the stale one is simply never read again (no explicit eviction needed). Files live
 * under the OS cache directory (`Paths.cache`), which the system may reclaim under storage pressure —
 * a miss just re-downloads, so that's safe by design.
 *
 * Native only: web never installs the embedded runtime (see `startup.web.ts`), so this module is
 * imported solely from the native `startup.ts` and never enters the web bundle.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { BundleCache } from '@comical/host-rn';

const CACHE_DIR = 'comical-bundles';

/** Filesystem-safe filename. Bridge ids are slug-like, but sanitize defensively; the hex sha256
 *  already guarantees uniqueness, so the id is just a human-readable prefix. */
function fileName(id: string, sha256: string): string {
  return `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${sha256}.js`;
}

function cacheDir(): Directory {
  return new Directory(Paths.cache, CACHE_DIR);
}

export const fileSystemBundleCache: BundleCache = {
  async read(id, sha256) {
    try {
      const file = new File(cacheDir(), fileName(id, sha256));
      return file.exists ? await file.text() : null;
    } catch {
      return null; // an unreadable/corrupt entry is a cache miss, never a hard failure
    }
  },
  async write(id, sha256, code) {
    try {
      const dir = cacheDir();
      if (!dir.exists) dir.create({ intermediates: true });
      new File(dir, fileName(id, sha256)).write(code);
    } catch {
      // Best-effort: a failed write (e.g. no free space) just means the next load re-downloads.
    }
  },
};

/** A cache filename is `${sanitizedId}-${sha256}.js`; the sha is exactly 64 hex chars, so we recover
 *  the id by stripping that fixed-shape suffix. Anything not matching is ignored (left untouched). */
const BUNDLE_FILE = /^(.*)-[0-9a-fA-F]{64}\.js$/;

/**
 * Sweep stale bundles. The cache holds one file per (id, sha256), and a bridge UPDATE writes its new
 * bundle under a fresh filename while the old one is never read again — but nothing deletes it (the
 * `BundleCache` contract is read/write only), so the folder grows monotonically over a bridge's life.
 * This keeps only the newest-written bundle per id and deletes the rest. Safe by design: a wrongly
 * pruned bundle is just a cache miss that re-downloads on next use. Call once at startup; native only.
 */
export function pruneBundleCache(): void {
  try {
    const dir = cacheDir();
    if (!dir.exists) return;
    const byId = new Map<string, File[]>();
    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      const m = BUNDLE_FILE.exec(entry.name);
      if (!m) continue;
      const list = byId.get(m[1]) ?? [];
      list.push(entry);
      byId.set(m[1], list);
    }
    for (const files of byId.values()) {
      if (files.length <= 1) continue;
      // Newest first (an update writes a newer file); keep [0], drop the rest.
      files.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
      for (const stale of files.slice(1)) {
        try {
          stale.delete();
        } catch {
          /* best-effort — a file we can't delete just stays until the OS reclaims the dir */
        }
      }
    }
  } catch {
    /* best-effort: a failed prune leaves the cache exactly as it was */
  }
}
