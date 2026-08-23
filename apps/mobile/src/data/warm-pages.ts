import { Image } from 'expo-image';

import { assetResolvesInFlight, resolveAssetSourceCached, supersedeBackgroundResolves } from '@/data/api';
import { traceJS } from '@/lib/gesture-trace';

// Warm expo-image's cache around the read position. Deduped through a module-level memo, and only
// http(s) sources are prefetched — a resolved local/data URI is already there.
const warmed = new Set<string>();
const WARM_MEMO_MAX = 2000;
export function warmPageImages(pages: string[]): void {
  // This window is now the guess; anything still queued from an older one isn't. Done before the
  // freshness filter, so a window that adds nothing new still retires what it replaced.
  supersedeBackgroundResolves(new Set(pages));
  const fresh = pages.filter((p) => !warmed.has(p));
  if (!fresh.length) return;
  if (warmed.size > WARM_MEMO_MAX) warmed.clear();
  for (const p of fresh) warmed.add(p);
  traceJS('warm', 'enqueue', { n: fresh.length, of: pages.length, inflight: assetResolvesInFlight() });
  // `background`: a warm is a GUESS about where the reader is going, and must never be served ahead
  // of a page that has actually mounted. See the resolve queue in data/api.ts.
  void Promise.all(
    fresh.map((p) =>
      resolveAssetSourceCached(p, { background: true }).catch(() => {
        // FORGET it. `warmed` is a "don't ask twice" memo, and a warm that produced no URL — dropped
        // because the reader passed the page or moved its window, or a round-trip that just failed —
        // warmed nothing. Left in the memo it would retire that page from the warm-ahead for the
        // rest of the session, so coming back to it would pay for a resolve at the moment it is
        // shown: precisely the cost `prefetchAhead` is set to avoid.
        warmed.delete(p);
        return null;
      }),
    ),
  ).then((urls) => {
    const http = urls.filter((u): u is string => !!u && !u.startsWith('data:'));
    if (http.length) void Image.prefetch(http);
  });
}
