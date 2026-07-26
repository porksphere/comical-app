/**
 * Resolve a bridge-supplied cover/asset URL into something `<Image>` can load, mirroring what the
 * reader does for page images. Most bridges hand back an absolute CDN URL — that passes straight
 * through with no async work or flash. A bridge whose cover CDN is Referer-gated (e.g. a gallery bridge)
 * instead hands back a server-relative `/img-proxy?…` path; that gets resolved through the shared
 * resolver — prefixed with the API base on web, fetched through the in-process transport (→ a `data:`
 * URI) on device — so covers work on every platform, not just the reader.
 *
 * Returns `undefined` while a relative path is still resolving (callers already show a skeleton
 * until the image's own `onLoad`), and on resolve failure. It NEVER returns the previous url's
 * answer — see the recycle-safety note below.
 */
import { useEffect, useRef, useState } from 'react';
import { peekResolvedAssetSource, resolveAssetSourceCached } from '@/data/api';

/** What's knowable about `url` without awaiting: itself when already absolute, a previously
 *  resolved server-relative path, else `undefined`. */
function knownResolution(url: string | undefined): string | undefined {
  return url ? peekResolvedAssetSource(url) : undefined;
}

export function useResolvedAsset(url: string | undefined): string | undefined {
  // Absolute URLs (the common case) resolve to themselves, and an already-resolved relative path is
  // known from the resolver's cache — so the usual answer is available during render, with no empty
  // first frame and no state commit at all.
  const [resolved, setResolved] = useState<string | undefined>(() => knownResolution(url));

  // Recycle-safety: the browse grid / rails / history list reuse component instances (recycleItems),
  // so this hook's state survives into the first render with a DIFFERENT url. Left to the effect
  // below, that render hands the recycled `<Image>` its new `recyclingKey` alongside the PREVIOUS
  // item's URI — which expo-image loads (instantly, from cache) and then cross-fades away from when
  // the right URI arrives a commit later under an unchanged key. That's the "old cover shows until
  // the new one loads" flash. Re-derive synchronously during render instead (React's "adjust state
  // on prop change" pattern, as used by `PageThumb`/`SeriesCard` for their own per-item state) so
  // the key and the URI always change together and the image view clears to its placeholder.
  const prevUrlRef = useRef(url);
  if (prevUrlRef.current !== url) {
    prevUrlRef.current = url;
    setResolved(knownResolution(url));
  }

  useEffect(() => {
    if (!url) {
      setResolved(undefined);
      return;
    }
    // Already knowable — no promise, no async resolve. Re-asserting it also covers the case where
    // another card resolved this path between this render and this effect; React bails out of the
    // re-render when the value is unchanged, which is the common path.
    const known = peekResolvedAssetSource(url);
    if (known !== undefined) {
      setResolved(known);
      return;
    }
    let alive = true;
    resolveAssetSourceCached(url)
      .then((u) => {
        if (alive) setResolved(u);
      })
      .catch(() => {
        if (alive) setResolved(undefined);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return resolved;
}
