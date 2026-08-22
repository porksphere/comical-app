import { Image } from 'expo-image';
import { File } from 'expo-file-system';

/**
 * SHA-256 (lowercase hex) of a page's image bytes, from bytes we ALREADY HOLD.
 *
 * This is the strong re-anchor key for a collected page: unlike the page URL it survives URL rot
 * and a chapter re-uploaded under a new id, so a reconcile can find the page again after a source
 * shuffles things. The runtime compares hashes written by one client against hashes computed later
 * by another, which is why the algorithm is fixed rather than opaque.
 *
 * **Never fetch a page in order to hash it.** Sparse hashes are expected and safe — reconcile only
 * acts on hits, and items adopt hashes they're handed later, so coverage grows as the user reads.
 * A miss here returns `undefined` and the collect PUT simply omits the field.
 *
 * Where the bytes come from without a network request: `expo-image` has already written the page to
 * its own disk cache to display it, and `getCachePathAsync` hands us that file. The cache key is
 * whatever URI string was given to `<Image>` — the reader passes `useImageProgress`'s `source`
 * (which on web is not the same as its `resolvedUri`), and sets no explicit `cacheKey`.
 *
 * The cache is evictable, so a miss is ordinary, not an error.
 */
export async function hashPageFromCache(cacheKey: string | null | undefined): Promise<string | undefined> {
  if (!cacheKey) return undefined;
  try {
    const path = await Image.getCachePathAsync(cacheKey);
    if (!path) return undefined; // not on disk (evicted, or never cached) — omit the hash
    const file = new File(path.startsWith('file://') ? path : `file://${path}`);
    if (!file.exists) return undefined;
    return await sha256Hex(await file.bytes());
  } catch {
    // Hashing is best-effort by design; never let it surface as a failed collect.
    return undefined;
  }
}

/** Lowercase hex SHA-256. `crypto.subtle` is native on web and provided on Hermes by
 *  `installWebCryptoShim()` (see `data/embedded/startup.ts`) — no extra dependency. That shim is a
 *  JS implementation, so this is NOT free over a ~1MB page: call it off the tap's critical path. */
async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined; // no WebCrypto here (e.g. native remote mode without the shim)
  const digest = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
