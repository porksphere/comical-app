/**
 * Durable on-disk store for downloaded page bytes. The `Downloads` manifest (in `@comical/downloads`,
 * persisted via the on-device store) records only *which* pages are downloaded and their relative
 * `file` path; the actual image bytes live here on the filesystem.
 *
 * Layout: `Paths.document/comical-downloads/<bridge>/<series>/<chapter>/<index>.<ext>`. Unlike
 * `bundle-cache.ts` (which uses `Paths.cache`, reclaimable by the OS), downloads must be **durable**,
 * so they live under `Paths.document`. The manifest stores the **relative** path (not an absolute
 * `file://`), because on iOS the document directory's absolute container path can change across app
 * updates — we reconstruct the absolute URI from `Paths.document` at read time (`uriFor`).
 *
 * Two write paths, both fed by the engine after it resolves a page: a `data:` URI (embedded mode
 * proxies bytes inline) is written base64-decoded; an http(s) URL is downloaded directly (with the
 * page's fetch headers). Operations are best-effort/guarded so a filesystem hiccup fails one page,
 * never the app.
 */
import { Directory, File, Paths } from 'expo-file-system';

const ROOT = 'comical-downloads';

/** Filesystem-safe path segment. Bridge/series/chapter ids can contain arbitrary characters. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** The relative manifest path for a page: `<bridge>/<series>/<chapter>/<index>.<ext>`. */
export function relPathFor(bridgeId: string, seriesId: string, chapterId: string, index: number, ext: string): string {
  return `${sanitize(bridgeId)}/${sanitize(seriesId)}/${sanitize(chapterId)}/${index}.${ext}`;
}

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

/** Guess a file extension from a data-URI media type or a URL, defaulting to `img`. */
export function extFor(resolved: string): string {
  const mime = resolved.startsWith('data:') ? resolved.slice(5, resolved.indexOf(';')) : '';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('avif')) return 'avif';
  const m = resolved.split('?')[0]?.match(/\.([a-zA-Z0-9]{1,5})$/);
  return m?.[1]?.toLowerCase() ?? 'img';
}

export interface BlobWriteResult {
  /** The relative path stored in the manifest. */
  relPath: string;
  /** On-disk size in bytes. */
  bytes: number;
}

/** Write a `data:...;base64,<b64>` URI's bytes to disk. */
function writeDataUri(relPath: string, dataUri: string): BlobWriteResult {
  const comma = dataUri.indexOf(',');
  const base64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  const file = prepared(relPath);
  file.write(base64, { encoding: 'base64' });
  return { relPath, bytes: file.size ?? 0 };
}

/**
 * Fetch an http(s) URL's bytes and write them to the EXACT `relPath` (sending the page's referer/auth
 * headers). Deliberately not `File.downloadFileAsync`: that can write to a filename derived from the
 * response headers rather than the destination we hand it, so the manifest would record `relPath` but
 * the bytes would land elsewhere — orphaning them (never deleted, and unreadable offline). Writing the
 * fetched bytes ourselves guarantees the file is exactly where the manifest says it is.
 */
async function writeFromUrl(relPath: string, url: string, headers?: Record<string, string>): Promise<BlobWriteResult> {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const file = prepared(relPath);
  file.write(bytes);
  return { relPath, bytes: file.size ?? bytes.byteLength };
}

/**
 * Store one resolved page. `resolved` is what `resolveAssetSource` returned — either a `data:` URI
 * (bytes inline) or an http(s) URL to fetch. Returns the manifest `file`/`bytes`.
 */
export async function storePage(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  index: number,
  resolved: string,
  headers?: Record<string, string>,
): Promise<BlobWriteResult> {
  const relPath = relPathFor(bridgeId, seriesId, chapterId, index, extFor(resolved));
  if (resolved.startsWith('data:')) return writeDataUri(relPath, resolved);
  return writeFromUrl(relPath, resolved, headers);
}

/** Remove stored blobs by their relative paths (best-effort). Prunes now-empty chapter dirs. */
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
