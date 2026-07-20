/**
 * Resolve a bridge-supplied cover/asset URL into something `<Image>` can load, mirroring what the
 * reader does for page images. Most bridges hand back an absolute CDN URL — that passes straight
 * through with no async work or flash. A bridge whose cover CDN is Referer-gated (e.g. Hitomi)
 * instead hands back a server-relative `/img-proxy?…` path; that gets resolved through the shared
 * resolver — prefixed with the API base on web, fetched through the in-process transport (→ a `data:`
 * URI) on device — so covers work on every platform, not just the reader.
 *
 * Returns `undefined` while a relative path is still resolving (callers already show a skeleton
 * until the image's own `onLoad`), and on resolve failure.
 */
import { useEffect, useState } from 'react';
import { resolveAssetSourceCached } from '@/data/api';

export function useResolvedAsset(url: string | undefined): string | undefined {
  // Absolute URLs (the common case) resolve to themselves — seed state with the url so there's no
  // empty first frame; only a server-relative path starts undefined and resolves asynchronously.
  const [resolved, setResolved] = useState<string | undefined>(() =>
    url && !url.startsWith('/') ? url : undefined,
  );

  useEffect(() => {
    if (!url) {
      setResolved(undefined);
      return;
    }
    if (!url.startsWith('/')) {
      setResolved(url);
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
