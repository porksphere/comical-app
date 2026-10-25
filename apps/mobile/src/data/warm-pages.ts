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
  //
  // Enqueued FARTHEST FIRST. The queue drains newest-first — for a page that mounts, newest means
  // nearest the viewport — so a window queued in reading order had its most distant page answered
  // first and the next page last. Reversed, the next page is the newest ask and goes first.
  //
  // Each page's bytes are fetched as ITS resolve lands, not once the whole window has: on a bridge
  // that answers resolves serially, waiting for all of them meant nothing moved until the slowest.
  for (const p of [...fresh].reverse()) {
    resolveAssetSourceCached(p, { background: true })
      .then((u) => {
        if (!u.startsWith('data:')) void Image.prefetch(u);
      })
      .catch(() => {
        // FORGET it. `warmed` is a "don't ask twice" memo, and a warm that produced no URL — dropped
        // because the reader passed the page or moved its window, or a round-trip that just failed —
        // warmed nothing. Left in the memo it would retire that page from the warm-ahead for the
        // rest of the session, so coming back to it would pay for a resolve at the moment it is
        // shown: precisely the cost `prefetchAhead` is set to avoid.
        warmed.delete(p);
      });
  }
}
