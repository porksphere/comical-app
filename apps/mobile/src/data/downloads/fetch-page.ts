/**
 * The device `PageFetcher` for the embedded download engine: turns a manifest `sourceUrl` into bytes
 * by reusing `resolveAssetSourceCached` — the exact resolver the reader uses — so referer/proxy
 * resolution and the in-process embedded intercept are shared, never duplicated. A resolve lands as
 * either a `data:` URI (embedded mode proxies bytes inline) or an http(s) URL to fetch with the
 * page's own headers.
 *
 * `onDevicePageRetry` is the engine's between-attempts hook: it busts the cached resolution so the
 * retry re-resolves (an expired time-scoped CDN URL is the common first-attempt failure).
 */
import type { FetchedPage, PageFetcher, PendingPage } from '@comical/downloads';
import { invalidateAssetSource, resolveAssetSourceCached } from '../api';

/** Manual base64 decode (no `atob`/`Buffer` guarantee across Hermes/JSC/QuickJS) — mirrors api.ts's encoder. */
function base64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? lookup[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? lookup[clean.charCodeAt(i + 3)] : 0;
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 0x0f) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 0x03) << 6) | d;
  }
  return out;
}

function dataUriToPage(uri: string): FetchedPage {
  const comma = uri.indexOf(',');
  const meta = comma >= 0 ? uri.slice(5, comma) : '';
  const mime = meta.split(';')[0] ?? '';
  const data = base64ToBytes(comma >= 0 ? uri.slice(comma + 1) : uri);
  return mime ? { data, contentType: mime } : { data };
}

export const devicePageFetcher: PageFetcher = async (_ctx, page) => {
  const resolved = await resolveAssetSourceCached(page.sourceUrl);
  if (resolved.startsWith('data:')) return dataUriToPage(resolved);
  const res = await fetch(resolved, page.headers ? { headers: page.headers } : undefined);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('Content-Type');
  return contentType ? { data, contentType } : { data };
};

/** Between-attempts hook: drop the stale resolution so the engine's retry re-resolves the page. */
export function onDevicePageRetry(page: PendingPage): void {
  invalidateAssetSource(page.sourceUrl);
}
