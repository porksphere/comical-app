import { warmImage } from '@/components/reader/image-progress';
import { assetResolvesInFlight, resolveAssetSourceCached, supersedeBackgroundResolves } from '@/data/api';
import { traceJS } from '@/lib/gesture-trace';

// Warm the cache the reader will read pages from around the read position (expo-image's on native,
// the browser's on web — `warmImage` asks the way the reader will). Deduped through a module-level
// memo, and only http(s) sources are prefetched — a resolved local/data URI is already there.
const warmed = new Set<string>();
const WARM_MEMO_MAX = 2000;

/**
 * How many warms load at once. A browser opens six connections to our server, and a page behind a
 * paced bridge (e-hentai's run seconds apart) holds one for as long as it waits its turn there, so an
 * uncapped warm-ahead took every connection and the app's other requests — progress, history —
 * queued behind it. Two leaves the reader's own pages and the rest of the app room.
 */
const WARM_CONCURRENCY = 2;

/** Each page of the latest window → its place in reading order. Warms go in that order. */
let windowOrder = new Map<string, number>();
/** Resolved, waiting for a slot: page → the URL to warm. */
const waitingWarms = new Map<string, string>();
/** Loading now: page → how to stop it. The token tells this warm's end from a later one's. */
const runningWarms = new Map<string, { token: object; cancel: () => void }>();

/** The pump runs a tick after a resolve lands, never inside it: resolves over HTTP all land at
 *  once, farthest first, and pumped as each landed the farthest page took the first slot. */
let pumpScheduled = false;
function schedulePump(): void {
  if (pumpScheduled) return;
  pumpScheduled = true;
  setTimeout(() => {
    pumpScheduled = false;
    pumpWarms();
  }, 0);
}

function pumpWarms(): void {
  while (runningWarms.size < WARM_CONCURRENCY && waitingWarms.size > 0) {
    let next: string | undefined;
    let best = Infinity;
    for (const page of waitingWarms.keys()) {
      const rank = windowOrder.get(page) ?? Infinity;
      if (next === undefined || rank < best) {
        next = page;
        best = rank;
      }
    }
    const page = next!;
    const uri = waitingWarms.get(page)!;
    waitingWarms.delete(page);
    const token = {};
    const cancel = warmImage(uri, () => {
      if (runningWarms.get(page)?.token === token) runningWarms.delete(page);
      pumpWarms();
    });
    runningWarms.set(page, { token, cancel });
  }
}

/** Stop and forget every warm outside the new window — still waiting, or already loading. Forgotten,
 *  so coming back to one warms it again. A page the reader has mounted keeps its own request. */
function retireWarmsOutside(keep: ReadonlyMap<string, number>): void {
  for (const page of [...waitingWarms.keys()]) {
    if (keep.has(page)) continue;
    waitingWarms.delete(page);
    warmed.delete(page);
  }
  for (const [page, { cancel }] of [...runningWarms]) {
    if (keep.has(page)) continue;
    runningWarms.delete(page);
    warmed.delete(page);
    cancel();
  }
}

/** `pages` is the window in reading order; it replaces the previous one. */
export function warmPageImages(pages: string[]): void {
  // This window is now the guess; anything still queued from an older one isn't. Done before the
  // freshness filter, so a window that adds nothing new still retires what it replaced.
  supersedeBackgroundResolves(new Set(pages));
  windowOrder = new Map(pages.map((p, i) => [p, i]));
  retireWarmsOutside(windowOrder);
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
  // first and the next page last. Reversed, the next page is the newest ask and goes first. (Where
  // a resolve is immediate, as over HTTP, the warms themselves still go in reading order: they
  // are taken by `windowOrder`, not by when their resolves landed — see `schedulePump`.)
  //
  // Each page's bytes are fetched as ITS resolve lands, not once the whole window has: on a bridge
  // that answers resolves serially, waiting for all of them meant nothing moved until the slowest.
  for (const p of [...fresh].reverse()) {
    resolveAssetSourceCached(p, { background: true })
      .then((u) => {
        if (u.startsWith('data:')) return;
        // The window moved on while this resolved.
        if (!windowOrder.has(p)) {
          warmed.delete(p);
          return;
        }
        waitingWarms.set(p, u);
        schedulePump();
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
