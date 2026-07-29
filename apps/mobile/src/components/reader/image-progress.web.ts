import { useEffect, useState } from 'react';

import { getApiBase } from '@/data/api';

import type { ImageProgress } from './image-progress';

// How a reader page learns *how much* of its image has downloaded (WEB).
//
// expo-image's web implementation exposes no `onProgress` (a DOM <img> can't report bytes), so
// unlike native we read the bytes ourselves: an XHR with `responseType: 'blob'` reports
// loaded/total as they stream, and the finished blob becomes an object URL that <Image> renders
// with no second network request. See `image-progress.ts` for the shared contract.
//
// The catch is CORS. An <img> renders cross-origin without it, but *reading* the bytes needs
// `Access-Control-Allow-Origin` — which our own host-server sends on every route, and a source's
// CDN may or may not. Rather than assume (many CDNs do allow it, and gating on same-origin alone
// would mean no percentage at all for any bridge that hands out direct CDN URLs), we try, and
// remember the origins that refuse: a blocked read falls back to letting <Image> load the URL
// itself — no percentage, but the page still appears — and every later page from that origin skips
// the attempt outright. Worst case is one wasted request per origin per session, not per page.
const unreadableOrigins = new Set<string>();

function originOf(uri: string): string | null {
  try {
    return new URL(uri, window.location.href).origin;
  } catch {
    return null;
  }
}

/** Is it worth trying to read this URL's bytes? */
function measurable(uri: string): boolean {
  if (uri.startsWith('data:') || uri.startsWith('blob:')) return false; // already local — instant
  if (uri.startsWith(getApiBase())) return true; // ours: always readable
  const origin = originOf(uri);
  return origin !== null && !unreadableOrigins.has(origin);
}

/** See `image-progress.ts` — scopes a download's state to the URI+attempt that produced it, so a
 *  stale one is dropped by key mismatch at read time rather than cleared in an effect. */
const keyOf = (uri: string | null, attempt: number) => `${uri ?? ''}#${attempt}`;

/** See `image-progress.ts`'s copy — every chunk is otherwise a render, on every page in the reader's
 *  window at once. Declared again rather than imported because on web `./image-progress` resolves to
 *  THIS file. */
const STEP_PERCENT = 5;

type Download = { key: string; source: string | null; percent: number | null; error: string | null };

export function useImageProgress(uri: string | null, attempt: number): ImageProgress {
  const [download, setDownload] = useState<Download | null>(null);
  const key = keyOf(uri, attempt);
  const live = download?.key === key ? download : null;
  // Hand <Image> the URL directly when there are no bytes worth reading (a data: URI, or an origin
  // already known to block reads). Derived at render — an effect would cost an extra pass.
  const passthrough = !!uri && !measurable(uri);

  useEffect(() => {
    if (!uri || passthrough) return;

    // The browser HTTP cache still serves this (the image routes send Cache-Control), so an
    // already-cached page costs no network — it just completes immediately at 100%.
    const xhr = new XMLHttpRequest();
    let objectUrl: string | null = null;
    xhr.open('GET', uri, true);
    xhr.responseType = 'blob';
    xhr.onprogress = (e) => {
      // `lengthComputable` is false without a Content-Length (a chunked upstream): no denominator,
      // so no percentage — the skeleton alone carries the loading state.
      if (!e.lengthComputable || e.total <= 0) return;
      const percent = Math.min(99, Math.round((e.loaded / e.total) * 100));
      setDownload((d) => {
        if (d?.key === key && d.percent !== null) {
          if (d.percent === percent) return d;
          if (percent < 99 && Math.abs(d.percent - percent) < STEP_PERCENT) return d;
        }
        return { key, source: d?.key === key ? d.source : null, percent, error: null };
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
        objectUrl = URL.createObjectURL(xhr.response as Blob);
        setDownload({ key, source: objectUrl, percent: 100, error: null });
      } else {
        setDownload({ key, source: null, percent: null, error: `HTTP ${xhr.status}` });
      }
    };
    xhr.onerror = () => {
      // A CORS-blocked read and a genuinely dead network are indistinguishable here (both surface
      // as a bare onerror with status 0). So for anything that isn't ours, assume CORS, stop
      // measuring that origin, and let <Image> fetch the URL itself — if the network really is the
      // problem, the <Image> fails too and the caller's retry/failure path handles it as before.
      // Only our own server's failures are reported as errors, where status 0 can't mean CORS.
      const origin = originOf(uri);
      if (origin && !uri.startsWith(getApiBase())) {
        unreadableOrigins.add(origin);
        setDownload({ key, source: uri, percent: null, error: null });
      } else {
        setDownload({ key, source: null, percent: null, error: 'network error' });
      }
    };
    xhr.send();

    return () => {
      xhr.abort(); // scrolled away / retried mid-download — stop paying for bytes we won't show
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, attempt, key, passthrough]);

  return {
    source: passthrough ? uri : (live?.source ?? null),
    percent: passthrough ? null : (live?.percent ?? null),
    error: live?.error ?? null,
    imageProps: {},
  };
}
