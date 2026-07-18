/**
 * Durable on-disk store for downloaded page bytes — the device `BlobStore` behind the shared
 * `@comical/downloads` engine (which runs in-process via `@comical/host-rn` in embedded mode). The
 * manifest records only *which* pages are downloaded and their relative `file` path; the actual image
 * bytes live here on the filesystem.
 *
 * Layout: `Paths.document/comical-downloads/<relPath>` where `<relPath>` follows the shared
 * convention in `@comical/downloads`' `paths.ts` (`<bridge>/<series>/<chapter>/<index>.<ext>`,
 * sanitized) — one layout across every host, so existing manifests keep resolving. Unlike
 * `bundle-cache.ts` (which uses `Paths.cache`, reclaimable by the OS), downloads must be **durable**,
 * so they live under `Paths.document`. The manifest stores the **relative** path (not an absolute
 * `file://`), because on iOS the document directory's absolute container path can change across app
 * updates — we reconstruct the absolute URI from `Paths.document` at read time (`uriFor`).
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { BlobStore } from '@comical/downloads';

const ROOT = 'comical-downloads';

/** The `File` for a stored relative path, rooted at the (current) document directory. */
function fileFor(relPath: string): File {
  return new File(Paths.document, ROOT, ...relPath.split('/'));
}

/** The absolute `file://` URI for a stored relative path — what the reader hands `<Image>`. */
export function uriFor(relPath: string): string {
  return fileFor(relPath).uri;
}

/** Ensure a file's parent directory exists, returning the `File` handle. */
function prepared(relPath: string): File {
  const file = fileFor(relPath);
  const dir = file.parentDirectory;
  if (!dir.exists) dir.create({ intermediates: true });
  if (file.exists) file.delete();
  return file;
}

/**
 * The device `BlobStore` the embedded download engine writes through. `write` lands the fetched
 * bytes at EXACTLY the manifest's `relPath` (never a name derived from response headers), so the
 * file is always where the manifest says it is; `remove`/`removeAll` back the engine's deletion
 * cascade. No `read` — the reader consumes blobs by `file://` URI (`uriFor`), never through a route.
 */
export const expoBlobStore: BlobStore = {
  async write(relPath, data) {
    const file = prepared(relPath);
    file.write(data);
    // Trust the length we just wrote rather than stat-ing the file back: a raw byte write lands exactly
    // `data.byteLength` on disk, and `File.size` is a native stat we were paying on every page.
    return { bytes: data.byteLength };
  },
  async remove(relPaths) {
    removeBlobs(relPaths);
  },
  async removeAll() {
    removeAllBlobs();
  },
  async usage() {
    return downloadsDiskUsage();
  },
};

/** Remove stored blobs by their relative paths (best-effort). */
export function removeBlobs(relPaths: string[]): void {
  for (const relPath of relPaths) {
    try {
      const file = fileFor(relPath);
      if (file.exists) file.delete();
    } catch {
      // best-effort; a leftover byte file is harmless (the manifest no longer references it)
    }
  }
}

/** Delete the entire downloads directory (used by "Delete all" as a belt-and-suspenders sweep). */
export function removeAllBlobs(): void {
  try {
    const dir = new Directory(Paths.document, ROOT);
    if (dir.exists) dir.delete();
  } catch {
    // best-effort
  }
}

/**
 * The ACTUAL bytes the downloads directory occupies on disk (durable, under Documents). Shown next to
 * the manifest's rolled-up total so a gap surfaces any orphaned blobs. Returns 0 if unavailable (web).
 */
export function downloadsDiskUsage(): number {
  try {
    const dir = new Directory(Paths.document, ROOT);
    return dir.exists ? (dir.size ?? 0) : 0;
  } catch {
    return 0;
  }
}
