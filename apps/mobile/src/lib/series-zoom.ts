import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { createContext, useCallback, useContext, useEffect, useState, type RefObject } from 'react';
import { Dimensions } from 'react-native';

import { traceJS } from '@/lib/gesture-trace';
import { unscaleFromBackdrop } from '@/lib/series-backdrop';

/**
 * The SOURCE RECT of the card a series was opened from, so
 * the series page can grow out of it (and shrink back into it) the way a photo grid opens a photo.
 *
 * A one-slot module-level hand-off, not context or a store, for the same reason
 * `lib/series-backdrop.ts` is: the writer (a card in a recycled grid) and the reader (a
 * modal route that is not its descendant) share no provider, and the value has to be readable
 * SYNCHRONOUSLY in the destination's first render — a state update would land a frame late, i.e.
 * after the entrance has already started from the wrong geometry.
 *
 * Rect capture happens on press-IN (a native `measureInWindow` round trip is async, and doing it
 * on press would delay navigation by a frame), so a hold that never becomes a tap — a long-press
 * context menu, a drag that turns into a scroll — also writes one. Two guards keep a stale rect
 * from being applied to an unrelated open: the entry id must match the destination's, and the
 * capture must be recent.
 *
 */

/** A thumbnail's on-screen box, in WINDOW coordinates (what `measureInWindow` reports), plus the
 *  corner radius it is drawn with. The RADIUS travels with the rect because the transition draws
 *  a copy of that thumbnail and has to match it: a grid card's cover is rounded 10, a History or
 *  Activity row's is rounded 6, and a copy that assumed one of them was visibly wrong on the
 *  other at the moment it landed. (The library reads the same thing off the source element's own
 *  styles — `getSourceBorderRadius`.) */
export type ZoomRect = { x: number; y: number; width: number; height: number };
export type ZoomOrigin = ZoomRect & { radius: number };

/**
 * Which CARD a capture came from — not which series. One series can be on screen in several places
 * at once (a browse grid under an open series page, a related rail, the results of a search LAYER
 * inside that very page), and only ONE of them is the box the page grew out of and will collapse
 * back into. That one blanks its cover; the others must keep showing theirs.
 *
 * Keying the blank on the series id alone got this wrong in exactly the case the layers create:
 * open series X, tap one of its tags, and X's own card in the search results came up with a hole
 * where its cover should be — blanked on behalf of a page it had nothing to do with.
 *
 * An opaque counter, handed out per card instance (`newZoomSourceKey`). Compared alongside the id,
 * so a recycled card that has moved on to another entry doesn't answer for its predecessor.
 */
export type ZoomSourceKey = number;
let nextSourceKey = 1;
function newZoomSourceKey(): ZoomSourceKey {
  return nextSourceKey++;
}

/**
 * The key belongs to the LIST, not to the card — provided by whatever renders a run of them.
 *
 * It was per card INSTANCE for a while, and that is wrong for the one thing it exists to survive:
 * the grid and the rails recycle instances (`recycleItems`), so a slot handed a different entry
 * re-renders rather than remounting, and the instance's key goes with it. Series A ends up drawn by
 * an instance that is not the one whose key the open page is holding, and the page's own accounting
 * looks perfect the whole time — a recording of the bug has the hold on src=1 taken at 136ms and
 * released at 11684ms, spanning the entire collapse, while the card it names sat there unblanked
 * because nothing was listening on that slot any more.
 *
 * A list is the right owner. It is stable across recycling, and it still separates the copies this
 * has to separate: the browse grid, each rail, and a search LAYER's results are different lists, so
 * opening series A from search does not blank A's card in the grid underneath. One list showing the
 * same series twice is not a thing.
 *
 * Cards outside any list (a context menu's preview) fall back to a key of their own, which is what
 * per-instance always was and is correct where nothing recycles.
 */
export const ZoomSurfaceContext = createContext<ZoomSourceKey | null>(null);

/** Both hooks run unconditionally — the fallback is allocated whether or not it gets used. */
export function useZoomSourceKey(): ZoomSourceKey {
  const surface = useContext(ZoomSurfaceContext);
  const [own] = useState(newZoomSourceKey);
  return surface ?? own;
}

/**
 * A surface's key, derived from its NAME rather than allocated when it mounts.
 *
 * Allocating one per mount was the second version of this and it was still not stable enough. A
 * recording of the bug has `card blank src=2` at 2549ms and then silence from that card forever —
 * the release at 19328ms drew no answer at all, where a search layer's card on a still-mounted list
 * answered its own release within 9ms. The list holding key 2 went away while the page opened from
 * it was still up, and whatever replaced it came back with a key nobody was holding. Same failure
 * as the per-instance key, one level up.
 *
 * Memoised by name, so a surface that unmounts and comes back lands on the key it had before.
 * Nothing new had to be invented to name them: every `RecyclerList` already carries a `scopeKey`
 * saying what it is showing, and a rail has its section id. The map is bounded by the number of
 * distinct surfaces the app can name.
 */
const surfaceKeys = new Map<string, ZoomSourceKey>();
export function useZoomSurfaceKey(surface: string): ZoomSourceKey {
  let key = surfaceKeys.get(surface);
  if (key === undefined) {
    key = newZoomSourceKey();
    surfaceKeys.set(surface, key);
  }
  return key;
}

type Capture = { id: string; source: ZoomSourceKey; origin: ZoomOrigin; at: number };

/** A consumed capture: where to grow from, and which card to blank while doing it. */
export type TakenZoom = { origin: ZoomOrigin; source: ZoomSourceKey };

/** Beyond this, a captured rect is assumed to belong to some earlier, abandoned press. */
const MAX_AGE_MS = 1500;

let pending: Capture | null = null;
/** The last capture actually handed out. Kept so a double-invoked `useState` initializer (React
 *  StrictMode renders twice in dev) sees the same origin both times instead of losing it. */
let taken: Capture | null = null;

/** Called from a series card's press-in. Overwrites any earlier capture — the newest press wins. */
export function setZoomOrigin(id: string, source: ZoomSourceKey, origin: ZoomOrigin): void {
  pending = { id, source, origin, at: Date.now() };
}

/**
 * Consumes the pending capture, but only if it was made for THIS series and recently enough.
 * Returns null otherwise — the caller then falls back to its non-zoom entrance.
 *
 * A FRESH capture always beats the remembered one. The `taken` fallback exists for a
 * double-invoked `useState` initializer, which re-runs in the same tick with nothing new pressed;
 * it used to be consulted FIRST, which meant a genuine second open of the same series within
 * MAX_AGE_MS silently reused the previous card — its rect AND its source key. Open a series, tap a
 * tag, and open that same series from the results quickly enough and the new page grew out of the
 * browse card's box instead of the result card's, blanked the browse card on the result card's
 * behalf, and left the result card's own capture sitting in `pending` to be mistaken for some
 * later open's. Checking `pending` first costs the StrictMode case nothing: the first invoke
 * consumes it, so the second finds none and falls through to exactly the same answer.
 */
export function takeZoomOrigin(id: string | undefined): TakenZoom | null {
  if (!id) return null;
  const now = Date.now();
  const fresh = pending && pending.id === id && now - pending.at <= MAX_AGE_MS ? pending : null;
  if (!fresh) {
    // Any stale capture is dropped here too — it belonged to a press that went somewhere else.
    pending = null;
    if (taken && taken.id === id && now - taken.at <= MAX_AGE_MS) {
      traceJS('zoom', 'take.reuse', { src: taken.source });
      return { origin: taken.origin, source: taken.source };
    }
    traceJS('zoom', 'take.none', {});
    return null;
  }
  pending = null;
  taken = fresh;
  traceJS('zoom', 'take', { src: fresh.source });
  return { origin: fresh.origin, source: fresh.source };
}

/**
 * A card that can still be measured. The captured rect says where the page grew FROM; it goes stale
 * as an answer for where it collapses BACK TO, because reading reorders a last-read list.
 *
 * Not every source can answer — the context menu synthesises its rect from a lifted preview and
 * registers nothing, so the exit keeps the capture.
 */
/** One card's identity: the series shown AND the surface showing it. */
const slot = (id: string, source: ZoomSourceKey) => `${source}\u0000${id}`;

export type ZoomOriginProbe = () => Promise<ZoomOrigin | null>;

const probes = new Map<string, ZoomOriginProbe>();

/** A measure that hasn't answered in a couple of frames never will — detached, or recycled away. */
const PROBE_TIMEOUT_MS = 100;

function registerZoomSource(id: string, source: ZoomSourceKey, probe: ZoomOriginProbe): () => void {
  const key = slot(id, source);
  probes.set(key, probe);
  // Only if still ours: a recycled slot re-registers before the old instance's cleanup runs.
  return () => {
    if (probes.get(key) === probe) probes.delete(key);
  };
}

/** Where that card is NOW, or null if it can no longer say. */
export async function measureZoomSource(id: string, source: ZoomSourceKey): Promise<ZoomOrigin | null> {
  const probe = probes.get(slot(id, source));
  if (!probe) {
    traceJS('zoom', 'probe.none', { src: source });
    return null;
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PROBE_TIMEOUT_MS));
  const measured = await Promise.race([probe(), timeout]);
  traceJS('zoom', measured ? 'probe' : 'probe.miss', { src: source });
  return measured;
}

/**
 * A surface that can bring one of its items into view — a card can say where it is, only the
 * scroller can fix being off screen. Called under a page that still covers the screen, so the
 * scroll is never seen. Takes the SERIES id, not a list key, so a list keyed on something else
 * (History's are `bridgeId:seriesId`) maps it itself. See AGENTS.md → Zoom transitions.
 */
export type ZoomSurfaceReveal = (id: string) => void;

const reveals = new Map<ZoomSourceKey, ZoomSurfaceReveal>();

/** Register this list as able to reveal its items. Safe to call unconditionally. */
export function useZoomSurfaceReveal(surface: ZoomSourceKey, reveal: ZoomSurfaceReveal): void {
  useEffect(() => {
    reveals.set(surface, reveal);
    return () => {
      if (reveals.get(surface) === reveal) reveals.delete(surface);
    };
  }, [reveal, surface]);
}

/**
 * A surface announcing that its items moved. Measuring once at collapse start assumes the source
 * stops moving when you let go; the write and refetch behind a reorder are async and either can
 * land mid-collapse, so a collapse in flight subscribes and re-aims.
 */
const watchers = new Map<ZoomSourceKey, Set<() => void>>();

/** No-op unless a collapse is in flight. */
export function notifyZoomSurfaceChanged(surface: ZoomSourceKey): void {
  const set = watchers.get(surface);
  if (!set?.size) return;
  traceJS('zoom', 'surface.moved', { src: surface });
  for (const fn of set) fn();
}

/** Subscribe a collapse to its own surface's movement. */
export function onZoomSurfaceChange(surface: ZoomSourceKey, fn: () => void): () => void {
  let set = watchers.get(surface);
  if (!set) {
    set = new Set();
    watchers.set(surface, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) watchers.delete(surface);
  };
}

/** Partly clipped isn't good enough — the copy would finish half off the edge. */
function onScreen(rect: ZoomOrigin): boolean {
  const { width, height } = Dimensions.get('window');
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height;
}

/** Two frames: long enough for a non-animated scroll to lay out. */
function afterLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Give up re-asking. Has to outlast the feeds' own reorder spring (`ROW_REORDER_TRANSITION`, ~240ms
 * to rest ≈ 29 frames at 120Hz), since the card is now SLIDING to its new slot rather than
 * teleporting there — stop early and the collapse aims at wherever it had got to. The walk exits as
 * soon as two answers agree, so this only bites when something never settles.
 */
const SETTLE_FRAMES = 40;

/**
 * Where a collapse should land, re-asked until the answer stops moving, having first scrolled the
 * card back into view if the list moved it out.
 *
 * One measurement is not enough for a reorder. The list writes new container positions into its own
 * store, and a container's `top` only reaches the view in the render that reads it — a commit after
 * the data change that announced the move. Measure in that same tick and the card answers with where
 * it WAS, which is the stale target a held drag then collapses into.
 *
 * Each distinct answer is handed over as it arrives, so a collapse already in flight re-aims instead
 * of waiting for the walk to finish; the first one is the pre-move spot the caller is already aimed
 * at, so reporting it costs nothing. With the feeds animating their reorder this also means the
 * page TRACKS the sliding row rather than jumping to where it will end up. Degrades in steps — no surface, the first measurement stands;
 * no card, nothing is reported and the caller keeps its capture.
 */
export async function resolveZoomTarget(
  id: string,
  source: ZoomSourceKey,
  onTarget: (rect: ZoomOrigin) => void,
): Promise<void> {
  let last: ZoomOrigin | null = null;
  let revealed = false;
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
    let next = await measureZoomSource(id, source);
    if (next && !onScreen(next) && !revealed) {
      revealed = true;
      const reveal = reveals.get(source);
      if (reveal) {
        traceJS('zoom', 'reveal', { src: source });
        reveal(id);
        await afterLayout();
        next = (await measureZoomSource(id, source)) ?? next;
      } else {
        traceJS('zoom', 'reveal.none', { src: source });
      }
    }
    if (!next) return;
    if (last && next.x === last.x && next.y === last.y) return;
    last = next;
    onTarget(next);
    await nextFrame();
  }
}

/** The shape of the thing a card measures — `View`'s, narrowed to the one method used. */
type Measurable = { measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void };

/**
 * Both halves of being a zoom source: the press-in capture that seeds the entrance, and the
 * registration that lets the exit ask again. One hook so the two can't disagree about which view or
 * which corner radius. Capture stays on press-in — `measureInWindow` is async, and doing it on press
 * would cost the navigation a frame.
 */
export function useZoomOriginSource(
  id: string,
  source: ZoomSourceKey,
  ref: RefObject<Measurable | null>,
  radius: number,
  enabled = true,
): () => void {
  const measure = useCallback(
    () =>
      new Promise<ZoomOrigin | null>((resolve) => {
        const view = ref.current;
        if (!enabled || !view) {
          resolve(null);
          return;
        }
        view.measureInWindow((x, y, width, height) => {
          // Zero-sized means not laid out — not a rect to fly to.
          if (width <= 0 || height <= 0) {
            resolve(null);
            return;
          }
          resolve(unscaleFromBackdrop({ x, y, width, height, radius }));
        });
      }),
    [enabled, radius, ref],
  );

  useEffect(() => registerZoomSource(id, source, measure), [id, source, measure]);

  return useCallback(() => {
    void measure().then((origin) => {
      if (origin) setZoomOrigin(id, source, origin);
    });
  }, [id, measure, source]);
}

/**
 * Which series are currently mid-zoom, by id (a count, because a drilled layer can be flying while
 * its parent still is). While a series is in here its card BLANKS ITS COVER — the transition flies
 * a copy of that cover, and leaving the original showing means two of them: visibly so on the way
 * back, where the page is half-transparent for most of the collapse and the grid shows straight
 * through it while the copy is still in the air.
 *
 * Exactly the treatment the long-press menu already gets (`SeriesCardMenu`'s `hidden` → the card's
 * `coverHidden`), for exactly the same reason, and what the library does with `shouldHideSource`.
 *
 * In-memory Legend State per the repo's split — a card reads it through a SELECTOR, so a grid of
 * them subscribes but only the one card whose boolean actually flips re-renders.
 */
const zoomingSources$ = observable<Record<string, number>>({});

/** Marks one card as flown-from; returns the matching release. A count, because the same card can
 *  be the source of two live pages (open a series, drill the same one from its related rail). */
export function holdZoomingSeries(id: string, source: ZoomSourceKey): () => void {
  const key = slot(id, source);
  zoomingSources$[key].set((n) => (n ?? 0) + 1);
  // Traced because "the source card came back unblanked" is a question about WHICH slot was held
  // and when it was let go, and with several series pages stacked over each other — a series, its
  // tag search, that same series again — there is no way to tell from the outside which of them
  // owned which card. `src` is the card instance's key, so a hold and its release can be paired up.
  traceJS('zoom', 'hold', { src: source, n: zoomingSources$[key].peek() ?? 0 });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (zoomingSources$[key].peek() ?? 1) - 1;
    traceJS('zoom', 'release', { src: source, n: next });
    if (next > 0) zoomingSources$[key].set(next);
    else zoomingSources$[key].delete();
  };
}

/** Whether THIS card should blank its cover right now. */
export function useIsZoomingSeries(id: string, source: ZoomSourceKey): boolean {
  const key = slot(id, source);
  return use$(() => !!zoomingSources$[key].get());
}
