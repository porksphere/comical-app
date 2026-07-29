import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ChapterNavigator } from '@/components/reader/chapter-navigator';
import { PagedReader, type PagedReaderHandle, type ReaderPageItem } from '@/components/reader/paged-reader';
import { ProgressPill } from '@/components/reader/progress-pill';
import { ReaderToolbar } from '@/components/reader/reader-toolbar';
import { SettingsControl } from '@/components/reader/settings-panel';
import { SwipeDismiss } from '@/components/reader/swipe-dismiss';
import { RetryBlock } from '@/components/retry-block';
import { ThemedText } from '@/components/themed-text';
import { WebtoonReader, type WebtoonReaderHandle } from '@/components/reader/webtoon-reader';
import { resolveAssetSourceCached } from '@/data/api';
import {
  chapterPagesQuery,
  directPagesQuery,
  inLibraryQuery,
  queryKeys,
  seriesListQuery,
} from '@/data/queries';
import { useDataSource, useMockActive, type DataSource } from '@/data/source';
import { DIRECT_CHAPTER_ID, type Chapter, type SeriesDetail, type SeriesListResult } from '@/data/types';
import { firstChapterInReadingOrder, getAdjacentChapter } from '@/lib/chapter-order';
import { getPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';
import { useReaderSettings } from '@/hooks/use-reader-settings';
import { useRouter } from '@/lib/nav';

// Full-screen page reader. Resolves a page-URL list from route params and
// renders either the horizontal Paged reader or the vertical Webtoon reader,
// with auto-hiding chrome (toolbar, progress pill, settings) layered on top.
// Always dark — the reader is its own black surface, not a ThemedView.

const CHROME_HIDE_MS = 3000;
// CI-speed override: scripted Maestro flows have per-step overhead (navigation,
// assertion retries) that can exceed 3s between reader-mount and a later
// chrome-dependent step — and once chrome auto-hides, the pill/toolbar drop out
// of the accessibility tree (pointerEvents: 'none'), reliably breaking any
// later tap/assert that assumed it was still up. Same flag as mock.ts's
// IS_DEMO_FAST (set only by e2e.yml); local dev keeps the real hide behavior.
const CHROME_AUTO_HIDE = process.env.EXPO_PUBLIC_COMICAL_DEMO_FAST !== '1';
// How close to the end of a chapter before the next chapter's pages are
// prefetched — restores comical-web's `prefetchNextChapter` reading smoothness.
// (How many page *images* to warm ahead is the user-configurable
// `settings.prefetchAhead`, comical-web's `prefetchAhead`.)
const NEXT_CHAPTER_TRIGGER = 3;
// How many pages BEHIND the current one to keep warm. The warm-ahead used to be strictly forward,
// which is right for reading and wrong for everything else you can do in a reader: paging back, and
// above all scrubbing, always arrived at a cold page. Small, because going back is the rarer move —
// the point is only that it isn't a cold start.
const WARM_BEHIND = 2;
// The web paged reader is not stitched (it hands boundary swipes to
// onPrev/onNext itself); the native one pages across a flat multi-chapter list.
const IS_WEB = Platform.OS === 'web';

/** One chapter's worth of pages inside the native pager's stitched flat list. */
type Segment = { id: string; name?: string; pages: string[] };

/** Warm expo-image's cache for a small window of upcoming pages. `pages` are now raw (unresolved)
 *  paths, so resolve them first (deduped/cached, shared with ReaderPage's own lazy resolve) and only
 *  prefetch the http(s) results — a `data:` URI is already inlined, nothing to fetch. Best-effort:
 *  failures are the per-page ReaderPage's problem to surface, not the prefetch's. */
/** Paths already handed to `Image.prefetch` this session. Warm windows overlap heavily — every page
 *  turn re-asks for most of the previous window, and a scrub re-asks several times a second — and
 *  each re-ask is a native round-trip to be told the image is already cached. Capped rather than
 *  grown forever; a wrap just re-warms, which is harmless. */
const warmed = new Set<string>();
const WARM_MEMO_MAX = 2000;

function warmPrefetch(pages: string[]): void {
  const fresh = pages.filter((p) => !warmed.has(p));
  if (!fresh.length) return;
  if (warmed.size > WARM_MEMO_MAX) warmed.clear();
  for (const p of fresh) warmed.add(p);
  void Promise.all(fresh.map((p) => resolveAssetSourceCached(p).catch(() => null))).then((urls) => {
    const http = urls.filter((u): u is string => !!u && !u.startsWith('data:'));
    if (http.length) void Image.prefetch(http);
  });
}

export default function ReaderScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const {
    seed,
    title,
    bridgeId,
    chapterId: paramChapterId,
    chapterName: paramChapterName,
    start,
    direct,
  } = useLocalSearchParams<{
    seed?: string;
    title?: string;
    bridgeId?: string;
    chapterId?: string;
    chapterName?: string;
    start?: string;
    /** '1' for a direct (chapterless) series — its pages ARE the series. */
    direct?: string;
  }>();
  const mock = useMockActive();
  const queryClient = useQueryClient();

  // ── Which chapter are we reading? ────────────────────────────────────────
  // A caller that knows the chapter passes it. One that DOESN'T — the card long-press menu, opening a
  // series you've never read — passes neither `chapterId` nor `direct`, and the reader starts at the
  // first chapter in reading order. Resolving it here is free: the reader already subscribes to the
  // chapter list below (it needs it for next/prev anyway), so the alternative was making every
  // long-press of an unread series fetch that same list just to label a menu row.
  //
  // Note a missing `chapterId` used to mean "direct" all by itself, which is why `direct` is now an
  // explicit param: absent chapterId no longer implies chapterless.
  const isDirect = direct === '1';
  const resolveFirst = !paramChapterId && !isDirect;
  const { data: listData } = useQuery(
    seriesListQuery(ds, mock, bridgeId ?? '', seed ?? '', false, !!seed && (!!paramChapterId || resolveFirst)),
  );
  const chapters = listData?.chapters;
  const firstChapter = useMemo(
    () => (resolveFirst && chapters?.length ? firstChapterInReadingOrder(chapters, getPreferredGroup()) : null),
    [resolveFirst, chapters],
  );
  const chapterId = paramChapterId ?? firstChapter?.id;
  // `|| undefined`: a seamless chapter crossing relabels via router.setParams,
  // which MERGES params — an unnamed chapter must overwrite the previous name
  // with '' (omitting the key would keep the stale one), so read '' back as
  // "no name" rather than as a real (empty) title.
  const chapterName = (paramChapterName || undefined) ?? firstChapter?.name;
  // Still waiting on the list to tell us where to start — don't fetch pages for the wrong thing.
  const resolvingFirst = resolveFirst && !chapterId;

  // Cached page fetch: reopening a chapter (or coming back to it) repaints from
  // the query cache instead of refetching, and next-chapter prefetch below can
  // pre-populate this same cache so the following chapter opens instantly.
  const {
    data: pages = null,
    error: queryError,
    refetch,
  } = useQuery({
    ...(chapterId
      ? chapterPagesQuery(ds, mock, bridgeId ?? '', seed ?? '', chapterId)
      : directPagesQuery(ds, mock, bridgeId ?? '', seed ?? '')),
    enabled: !resolvingFirst,
  });
  const error = queryError ? (queryError as Error).message || 'Failed to load pages' : null;
  const retry = refetch;

  // `start` is a page index, or the sentinel `'last'` — used when arriving from the
  // *next* chapter's "previous chapter" navigation, which should land on the last page.
  const startIndex = useMemo(() => {
    const lastPage = (pages?.length ?? 1) - 1;
    if (start === 'last') return Math.max(0, lastPage);
    return Math.max(0, Math.min(lastPage, Number(start ?? 0) || 0));
  }, [pages, start]);

  const [settings] = useReaderSettings();
  const [currentPage, setCurrentPage] = useState(startIndex);
  // The page under your eyes right now, with the stitched segment it belongs to
  // — see `shown` below. Null until the pager reports one.
  const [visibleSeg, setVisibleSeg] = useState<{
    id: string;
    page: number;
    total: number;
    name?: string;
  } | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  // Whether the reader is pinch-zoomed (paged page OR webtoon viewport) — suspends
  // the swipe-away gesture so a one-finger drag pans the zoomed image instead.
  const [readerZoomed, setReaderZoomed] = useState(false);

  // Swipe-away dismissal progress (0 at rest → 1 fully swiped off), written on
  // the UI thread by SwipeDismiss. The reader's own dark backdrop and its chrome
  // fade out from it, revealing the screen behind (the reader route is a
  // contained transparent modal, so the series screen stays rendered underneath).
  const dismissProgress = useSharedValue(0);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - dismissProgress.value }));
  const chromeFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dismissProgress.value, [0, 0.6], [1, 0]),
  }));

  // Auto-hide chrome; any toggle/show resets the timer.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While a chrome control is being HELD (see holdChrome), nothing may arm the
  // countdown — not a seek, not a swipe-guard release, not a fresh showChrome.
  // The hold is authoritative rather than just clearing the timer once, so a
  // scrub that fires callbacks the whole time it runs can't re-arm it by
  // accident and have the bar fade out from under the finger.
  const chromeHeldRef = useRef(false);
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!CHROME_AUTO_HIDE || chromeHeldRef.current) return;
    hideTimer.current = setTimeout(() => {
      setChromeVisible(false);
    }, CHROME_HIDE_MS);
  }, []);
  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  // Suspend the auto-hide for as long as a chrome control is being USED — the
  // page-jump input on web, the page slider on native. Both can be held longer
  // than CHROME_HIDE_MS, and having the bar fade (pointerEvents: 'none') out from
  // under a finger mid-drag is the one thing the timer must never do.
  const holdChrome = useCallback(
    (hold: boolean) => {
      chromeHeldRef.current = hold;
      if (hold) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      } else {
        setChromeVisible(true); // a scrub that outlasted a stray hide brings it back
        scheduleHide();
      }
    },
    [scheduleHide],
  );

  // Keeping chrome alive through a touch: rather than force it visible (which
  // would fight a tap-to-reveal toggle resolving on the same touch), a touch
  // just PAUSES the countdown — SwipeDismiss's `onTouchBegin` fires on raw
  // touch-down (RNGH's onBegin), before any activation threshold, so a drag
  // too small/slow to ever activate the pan is covered too. The countdown
  // resumes fresh from release (`onSwipeEnd`, RNGH's onFinalize — always fires
  // once the touch resolves, tap or drag, activated or not), so however long
  // the touch/drag itself takes, chrome stays up for the whole thing and for a
  // full CHROME_HIDE_MS after — never snatched away mid-touch or right as a
  // slow gesture completes.
  const pauseHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  // While a dismiss swipe is in flight (and briefly after), suppress the reader's
  // tap zones: a plain RN Pressable doesn't see the moves the RNGH pan consumes,
  // so on release the side/centre zone would otherwise fire a stray page-turn or
  // chrome-toggle. `onStart` sets this on gesture ACTIVATION (a pure tap never
  // activates the pan, so real taps are unaffected); the release schedules a
  // short cooldown so the tap that fires right at lift-off is still caught.
  const swipeActiveRef = useRef(false);
  const swipeClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginSwipeGuard = useCallback(() => {
    if (swipeClearTimer.current) clearTimeout(swipeClearTimer.current);
    swipeActiveRef.current = true;
  }, []);
  const endSwipeGuard = useCallback(() => {
    if (swipeClearTimer.current) clearTimeout(swipeClearTimer.current);
    swipeClearTimer.current = setTimeout(() => {
      swipeActiveRef.current = false;
    }, 150);
    // Resume the auto-hide countdown now that the touch has ended (a no-op if
    // a tap-toggle on the same touch already hid chrome and cleared this).
    scheduleHide();
  }, [scheduleHide]);
  useEffect(() => () => {
    if (swipeClearTimer.current) clearTimeout(swipeClearTimer.current);
  }, []);

  // Latest page in a ref so the tap-zone prev/next read it without stale closures
  // (and rapid taps advance correctly).
  const currentRef = useRef(startIndex);
  const setCurrent = useCallback((i: number) => {
    currentRef.current = i;
    setCurrentPage(i);
  }, []);

  // Pages resolve asynchronously (real fetch or mock delay); once they land,
  // jump to the requested start index — `currentPage`'s initial state was
  // computed before `pages` existed, so it can't reflect it yet.
  useEffect(() => {
    if (!pages) return;
    currentRef.current = startIndex;
    setCurrentPage(startIndex);
  }, [pages, startIndex]);

  // Warm-ahead: prefetch the next few page images into expo-image's cache as the
  // reader advances, and — for chaptered series, once near the end — prefetch the
  // next chapter's page list into the query cache (so opening it is instant) plus
  // its first few page images (so they're not cold the moment the reader lands
  // on them after auto-advancing).
  //
  // `warmAround` is also what a scrub calls (see the navigator's `onScrubPage`),
  // so the pages the drag is heading for are being fetched while it's still
  // moving rather than from a standing start on release.
  const warmAround = useCallback(
    (index: number) => {
      if (!pages?.length) return;
      warmPrefetch(pages.slice(Math.max(0, index - WARM_BEHIND), index + 1 + settings.prefetchAhead));
    },
    [pages, settings.prefetchAhead],
  );

  useEffect(() => {
    if (!pages || pages.length === 0) return;
    warmAround(currentPage);

    if (!chapterId || currentPage < pages.length - NEXT_CHAPTER_TRIGGER) return;
    const nextId = nextChapterId(queryClient, mock, bridgeId ?? '', seed ?? '', chapterId);
    if (nextId) {
      void queryClient.prefetchQuery(chapterPagesQuery(ds, mock, bridgeId ?? '', seed ?? '', nextId)).then(() => {
        const nextPages = queryClient.getQueryData<string[]>(
          queryKeys.chapterPages(mock, bridgeId ?? '', seed ?? '', nextId),
        );
        if (nextPages?.length) warmPrefetch(nextPages.slice(0, settings.prefetchAhead));
      });
    }
  }, [pages, currentPage, chapterId, ds, mock, queryClient, bridgeId, seed, settings.prefetchAhead, warmAround]);

  // ── Auto-advance to the next chapter ──────────────────────────────────────
  // Guards against a re-entrant double-advance (e.g. a rapid extra tap/scroll
  // past the end before the new chapter's pages have landed). Cleared once a
  // new `pages` list lands — either the auto-advance's own navigation, or any
  // other chapter change — so a later chapter-end can advance again.
  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [pages]);

  // Move to the adjacent chapter in reading order. `delta` +1 = next, -1 = previous.
  // `landing` says which end to arrive at, and defaults to whichever keeps PAGING
  // continuous — forward lands on page 1, backward on the last page, so stepping
  // off either end of a chapter reads as one uninterrupted sequence. An explicit
  // chapter JUMP (the navigator's skip buttons) passes 'first' either way.
  const goAdjacentChapter = useCallback(
    async (delta: 1 | -1, landing: 'first' | 'last' = delta === 1 ? 'first' : 'last') => {
      if (advancingRef.current || !chapterId) return;
      advancingRef.current = true;
      const target = await resolveAdjacentChapter(queryClient, ds, mock, bridgeId ?? '', seed ?? '', chapterId, delta);
      if (!target) {
        advancingRef.current = false;
        return;
      }
      const params: Record<string, string> = {
        seed: seed ?? '',
        title: title ?? '',
        start: landing === 'last' ? 'last' : '0',
        chapterId: target.id,
      };
      if (bridgeId) params.bridgeId = bridgeId;
      if (target.name) params.chapterName = target.name;
      // `replace`, not `push`: paging through a long series shouldn't pile up an
      // ever-growing back-stack of finished chapters.
      router.replace({ pathname: '/reader', params });
    },
    [chapterId, queryClient, ds, mock, bridgeId, seed, title, router],
  );
  const tryAdvanceChapter = useCallback(() => void goAdjacentChapter(1), [goAdjacentChapter]);
  const tryPrevChapter = useCallback(() => void goAdjacentChapter(-1), [goAdjacentChapter]);

  // ── Reading history / progress recording ─────────────────────────────────
  // Whether this series is in the library decides how a read is persisted (like
  // comical-web): a library series records chapter *progress* (updating its resume
  // cache), a non-library read goes into the reading log instead. `retry: false`
  // keeps a no-library-store 404 quiet — it just reads as "not in library".
  const { data: inLibrary } = useQuery({
    ...inLibraryQuery(ds, mock, bridgeId ?? '', seed ?? ''),
    retry: false,
  });
  // Title/thumbnail snapshot for a reading-log entry, taken from the cached series
  // detail if the reader was opened from the series screen (either layout key).
  const cachedDetail =
    queryClient.getQueryData<SeriesDetail>(queryKeys.seriesDetail(mock, bridgeId ?? '', seed ?? '', false)) ??
    queryClient.getQueryData<SeriesDetail>(queryKeys.seriesDetail(mock, bridgeId ?? '', seed ?? '', true));

  // Remember the scanlation group of the chapter being read, so next/prev keeps the
  // same source — including when the reader was opened from History/a deep link
  // (bypassing the chapter list, which otherwise sets this). Mirrors comical-web's
  // `openChapter`: only set when the chapter actually carries a group; never clear it.
  useEffect(() => {
    if (!chapterId) return;
    const group = chapters?.find((c) => c.id === chapterId)?.group;
    if (group !== undefined) setPreferredGroup(group);
  }, [chapterId, chapters]);

  // ── Adjacent chapters, stitched for seamless paging ──────────────────────
  // The next/previous chapters in reading order, resolved from the combined
  // chapter list (`chapters`); a still-cold list just resolves null, and the
  // tap fallbacks re-resolve via a fetch (`resolveAdjacentChapter`). `next`
  // also drives the webtoon end-of-chapter sentinel.
  const nextChapter = useMemo(() => {
    if (!chapterId || !chapters) return null;
    const current = chapters.find((c) => c.id === chapterId);
    return current ? getAdjacentChapter(chapters, current, 1, getPreferredGroup()) : null;
  }, [chapterId, chapters]);
  const prevChapter = useMemo(() => {
    if (!chapterId || !chapters) return null;
    const current = chapters.find((c) => c.id === chapterId);
    return current ? getAdjacentChapter(chapters, current, -1, getPreferredGroup()) : null;
  }, [chapterId, chapters]);

  // Their page lists, subscribed eagerly (cache-first; the list is just URLs)
  // so the native paged reader can stitch them into ONE flat pager — swiping
  // across a chapter boundary is then an ordinary page turn, with no
  // route-replace remount (the old sentinel/replace flow visibly tore the
  // reader down and back up between chapters).
  const { data: prevPages } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', seed ?? '', prevChapter?.id ?? ''),
    enabled: !!seed && !!chapterId && !!prevChapter,
  });
  const { data: nextPages } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', seed ?? '', nextChapter?.id ?? ''),
    enabled: !!seed && !!chapterId && !!nextChapter,
  });

  // The stitched window. A segment only joins once its pages are actually
  // loaded, so the flat list never has holes.
  //
  // It only ever GROWS while you read one continuous run: crossing forward
  // appends the new next chapter at the TAIL, so nothing at or before the
  // current position moves and the pager's scroll offset stays valid as-is.
  // (It used to be recomputed as [prev, current, next] on every crossing, which
  // dropped the chapter you'd just finished off the HEAD and shifted every
  // remaining cell by a whole chapter. The pager can re-anchor from that — see
  // paged-reader.tsx — but not before FlatList has rendered one pass with its
  // virtualization window around the now-stale offset, unmounting the page you
  // just landed on: a black flash right after the crossing settled.)
  //
  // Landing outside the run (chapter list, deep link, prev/next past either end
  // of the window) starts a fresh one, and `runKey` changes with it so the pager
  // remounts and seeds its position from `initialPage` instead of re-anchoring.
  //
  // The run is state, but what renders is a pure merge of it with the chapters
  // currently loaded — so a window that has just grown is used on the SAME render
  // that grows it, and the state write below only catches the result up. The
  // merge returns the existing array (identity included) when there's nothing to
  // add, which is what stops that write from looping.
  const [run, setRun] = useState<{ key: number; segs: Segment[] }>({ key: 0, segs: [] });
  const { segments, runKey } = useMemo(() => {
    if (!pages) return { segments: [] as Segment[], runKey: run.key };
    const currentId = chapterId ?? DIRECT_CHAPTER_ID;
    const prevSeg: Segment | null =
      chapterId && prevChapter && prevPages?.length
        ? { id: prevChapter.id, name: prevChapter.name, pages: prevPages }
        : null;
    const nextSeg: Segment | null =
      chapterId && nextChapter && nextPages?.length
        ? { id: nextChapter.id, name: nextChapter.name, pages: nextPages }
        : null;

    const at = run.segs.findIndex((s) => s.id === currentId);
    if (at === -1) {
      const segs: Segment[] = [];
      if (prevSeg) segs.push(prevSeg);
      segs.push({ id: currentId, name: chapterName, pages });
      if (nextSeg) segs.push(nextSeg);
      // Bump the key only when there was a real run to leave, so the very first
      // window doesn't count as a remount.
      return { segments: segs, runKey: run.key + (run.segs.length ? 1 : 0) };
    }
    // Extend, never drop.
    const stale = run.segs[at]!;
    const refreshCurrent = stale.pages !== pages || stale.name !== chapterName;
    const addPrev = !!prevSeg && at === 0;
    const addNext = !!nextSeg && run.segs[run.segs.length - 1]!.id === currentId;
    if (!refreshCurrent && !addPrev && !addNext) return { segments: run.segs, runKey: run.key };
    const segs = run.segs.slice();
    if (refreshCurrent) segs[at] = { id: currentId, name: chapterName, pages };
    if (addPrev) segs.unshift(prevSeg);
    if (addNext) segs.push(nextSeg);
    return { segments: segs, runKey: run.key };
  }, [run, pages, chapterId, chapterName, prevChapter, prevPages, nextChapter, nextPages]);
  useEffect(() => {
    // `!pages` (a chapter still loading) renders no window at all, but must not
    // wipe the run — the pager is unmounted then and comes back to the same one.
    if (!pages) return;
    if (segments !== run.segs || runKey !== run.key) setRun({ key: runKey, segs: segments });
  }, [pages, segments, runKey, run]);

  // Flat pager items. Keys are stable across window changes (`chapterId:page`) —
  // that's what lets the pager re-anchor the visible page when a segment does
  // land ahead of the current position (a previous chapter arriving late).
  const flatItems: ReaderPageItem[] = useMemo(
    () => segments.flatMap((s) => s.pages.map((uri, i) => ({ uri, key: `${s.id}:${i}`, pageNumber: i + 1 }))),
    [segments],
  );
  // How many stitched pages sit before the current chapter (flat index of the
  // current chapter's page 0).
  const prefixLen = useMemo(() => {
    const currentId = chapterId ?? DIRECT_CHAPTER_ID;
    let acc = 0;
    for (const s of segments) {
      if (s.id === currentId) break;
      acc += s.pages.length;
    }
    return acc;
  }, [segments, chapterId]);
  // The web pager keeps per-chapter pages (it hands boundary swipes to
  // onPrev/onNext itself — see paged-reader.web.tsx), so no stitching there.
  const currentItems: ReaderPageItem[] = useMemo(
    () =>
      (pages ?? []).map((uri, i) => ({ uri, key: `${chapterId ?? DIRECT_CHAPTER_ID}:${i}`, pageNumber: i + 1 })),
    [pages, chapterId],
  );

  // Which stitched segment a flat pager index falls in, and the page within it.
  const locateFlat = useCallback(
    (flat: number) => {
      let acc = 0;
      for (const s of segments) {
        if (flat < acc + s.pages.length) return { segment: s, page: flat - acc };
        acc += s.pages.length;
      }
      return null;
    },
    [segments],
  );

  // Kept in a ref (reassigned every render) so the debounce + unmount-flush
  // effects below always record the latest page/membership without re-subscribing.
  const recordRef = useRef<() => void>(() => {});
  recordRef.current = () => {
    if (!bridgeId || !seed || !pages || pages.length === 0 || inLibrary === undefined) return;
    const lastPage = currentRef.current;
    const pageCount = pages.length;
    // Invalidate the shared history list on a successful write so the series
    // screen's resume label (and the History tab) don't keep showing the
    // pre-read position after navigating back — `historyQuery` has a 5-min
    // staleTime, so without this it silently reads stale from cache. The
    // activity feed/badge derive `read` from the same progress, so refresh
    // them too — reading a new chapter should drop it from the pip at once.
    // The series screen's chapter list reads that progress directly (finishing a
    // chapter marks it read host-side), so it needs the same treatment.
    const invalidateHistory = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.history(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapterProgress(mock, bridgeId, seed) });
    };
    if (chapterId && inLibrary) {
      void ds
        .recordChapterProgress(bridgeId, seed, chapterId, {
          lastPage,
          pageCount,
          ...(chapterName ? { chapterName } : {}),
        })
        .then(invalidateHistory)
        .catch(() => {});
      return;
    }
    // Non-library read (or a direct/chapterless series): reading log. A direct
    // series has no real chapter — record the `__direct__` sentinel comical-web uses.
    void ds
      .recordReadingHistory({
        bridgeId,
        seriesId: seed,
        title: cachedDetail?.title ?? title ?? seed,
        ...(cachedDetail?.cover ? { thumbnailUrl: cachedDetail.cover } : {}),
        chapterId: chapterId ?? DIRECT_CHAPTER_ID,
        ...(chapterName ? { chapterName } : {}),
        lastPage,
        pageCount,
      })
      .then(invalidateHistory)
      .catch(() => {});
  };

  // Debounced record on page settle (avoids a write per flipped page), plus a
  // flush on unmount so the final resume position is always saved.
  useEffect(() => {
    if (!pages) return;
    const t = setTimeout(() => recordRef.current(), 1500);
    return () => clearTimeout(t);
  }, [currentPage, pages, inLibrary]);
  useEffect(() => () => recordRef.current(), []);

  const pagedRef = useRef<PagedReaderHandle>(null);
  const webtoonRef = useRef<WebtoonReaderHandle>(null);

  // Native paged reader position reports arrive as FLAT (stitched-list)
  // indices. Within the current chapter it's plain page bookkeeping; crossing
  // a chapter boundary flushes the old chapter's progress, then relabels the
  // route in place — router.setParams, NOT replace, so nothing remounts and
  // the swipe that carried the user across stays seamless. The relabel swaps
  // which chapter is "current": the stitched window slides one over, the pager
  // keeps its position (stable keys — it re-anchors on them itself), and the
  // start param is kept in step for the pages/startIndex sync effect above.
  const handleFlatPageChange = useCallback(
    (flat: number) => {
      const loc = locateFlat(flat);
      if (!loc) return;
      if (loc.segment.id === (chapterId ?? DIRECT_CHAPTER_ID)) {
        setCurrent(loc.page);
        return;
      }
      recordRef.current(); // old chapter's final settled position
      setCurrent(loc.page);
      router.setParams({
        chapterId: loc.segment.id,
        chapterName: loc.segment.name ?? '',
        start: String(loc.page),
      });
    },
    [locateFlat, chapterId, setCurrent, router],
  );

  // Same mapping, but for the page merely *scrolling past* — the pager reports
  // this as soon as a page is mostly on screen, so the chrome keeps up with a
  // fast flick instead of sitting still until the scroll settles. Display only:
  // no progress write, no route relabel (both belong to the settled page).
  //
  // Its segment is carried along, because a page mid-crossing belongs to a
  // DIFFERENT chapter than the committed one — the counter has to read against
  // that chapter's length, and the title has to be its name, or the crossing
  // shows "page 1 of 32" under the chapter you just left.
  const handleFlatVisiblePage = useCallback(
    (flat: number) => {
      const loc = locateFlat(flat);
      if (!loc) return;
      setVisibleSeg({
        id: loc.segment.id,
        page: loc.page,
        total: loc.segment.pages.length,
        name: loc.segment.name,
      });
      if (loc.segment.id === (chapterId ?? DIRECT_CHAPTER_ID)) setCurrent(loc.page);
    },
    [locateFlat, chapterId, setCurrent],
  );

  // What the chrome shows. Normally the committed chapter and page; while a
  // swipe is carrying a page from a neighbouring stitched chapter across the
  // screen, that page instead — so the title and counter turn over WITH the
  // crossing rather than a beat after it settles. Once the crossing lands, the
  // two agree, so nothing flickers back. Only trusted for the stitched pager,
  // and only while it names a chapter still in the window (a jump elsewhere
  // rebuilds the run and leaves this pointing at nothing).
  const shown = useMemo(() => {
    const v =
      !IS_WEB && settings.mode === 'paged' && visibleSeg && segments.some((s) => s.id === visibleSeg.id)
        ? visibleSeg
        : null;
    return {
      page: v?.page ?? currentPage,
      total: v?.total ?? pages?.length ?? 0,
      name: v ? v.name : chapterName,
    };
  }, [visibleSeg, segments, settings.mode, currentPage, pages, chapterName]);

  // What the top bar says. Series above, chapter below — NOT the page counter,
  // which both platforms already show in the bottom chrome (the slider's own
  // number on native, the progress pill on web). Repeating it up here spent the
  // toolbar's one line on the thing nothing else could say: which series this is.
  // Falls back to chapter-as-title when there's no series name to show (a direct
  // chapter opened by URL), rather than leaving the bar blank.
  const seriesTitle = cachedDetail?.title ?? title;

  const toggleChrome = useCallback(() => {
    if (swipeActiveRef.current) return; // a swipe-release tap, not a real chrome toggle
    setChromeVisible((v) => {
      const nextVisible = !v;
      if (nextVisible) scheduleHide();
      else if (hideTimer.current) clearTimeout(hideTimer.current);
      return nextVisible;
    });
  }, [scheduleHide]);

  // Chapter-local page index in, flat index out for the (stitched) native pager.
  const goTo = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min((pages?.length ?? 1) - 1, index));
      setCurrent(clamped);
      if (settings.mode === 'paged') pagedRef.current?.goToPage(IS_WEB ? clamped : prefixLen + clamped, animated);
      else webtoonRef.current?.goToPage(clamped);
    },
    [pages, settings.mode, setCurrent, prefixLen],
  );
  // The bottom scrubber's live drag. In the native paged reader this never comes
  // through JS at all: the navigator writes a FRACTIONAL page position into
  // `scrubFlat` and the pager scrolls to it on the UI thread, so the pages keep
  // up with the finger even while the list is busy rendering what it swept past.
  // `scrubbing` is the same drag as a plain boolean, for the things that do need
  // to know on the JS side (the pager's per-page re-render, the chrome hold).
  //
  // The webtoon reader has no such path (variable row heights, nothing to
  // interpolate), so it keeps the JS callback below.
  //
  // Nothing is committed by either — no `setCurrent`, no progress write; the
  // release settles onto a real page through `seekTo` below. The position is
  // clamped to this chapter, so a scrub can never run off either end into the
  // stitched neighbours.
  const scrubFlat = useSharedValue(-1);
  const [scrubbing, setScrubbing] = useState(false);
  const handleScrubbing = useCallback(
    (active: boolean) => {
      setScrubbing(active);
      holdChrome(active);
    },
    [holdChrome],
  );
  const scrubTo = useCallback(
    (position: number) => {
      const clamped = Math.max(0, Math.min((pages?.length ?? 1) - 1, position));
      if (settings.mode === 'paged') pagedRef.current?.scrubTo(IS_WEB ? clamped : prefixLen + clamped);
      else webtoonRef.current?.goToPage(Math.round(clamped), false);
    },
    [pages, settings.mode, prefixLen],
  );
  // Where a scrub lands. `goTo` alone isn't enough for the stitched pager: the
  // counter reads `visibleSeg`, which the pager reports from viewability — and
  // that's suppressed for the duration of the drag (see PagedReader's
  // `scrubbing`), so it would still be describing the page the drag started on
  // until the scroll settled and viewability fired again. Naming the landing
  // page here makes the whole chrome correct in the same commit that releases
  // the navigator's own scrub display, so nothing flickers back.
  const seekTo = useCallback(
    (index: number) => {
      goTo(index, true);
      if (!IS_WEB && settings.mode === 'paged') handleFlatVisiblePage(prefixLen + index);
    },
    [goTo, settings.mode, prefixLen, handleFlatVisiblePage],
  );
  const atLastPage = useCallback(() => !!pages && currentRef.current >= pages.length - 1, [pages]);
  const atFirstPage = useCallback(() => currentRef.current <= 0, []);
  // Tapping a page and keyboard navigation both turn instantly (no slide), on
  // every platform; only the progress-pill jump keeps the animated transition.
  //
  // At a chapter boundary in the native paged reader, prefer stepping within
  // the stitched flat list (same seamless relabel path a swipe crossing takes);
  // the route-level advance is only the fallback for when the adjacent pages
  // aren't stitched in yet (cold list / still loading) — or for web/webtoon,
  // whose readers aren't stitched.
  const turnPrev = useCallback(() => {
    if (swipeActiveRef.current) return; // stray tap at the end of a dismiss swipe
    if (!atFirstPage()) {
      goTo(currentRef.current - 1, false);
      return;
    }
    if (!IS_WEB && settings.mode === 'paged' && prefixLen > 0) {
      handleFlatPageChange(prefixLen - 1);
      pagedRef.current?.goToPage(prefixLen - 1, false);
      return;
    }
    tryPrevChapter();
  }, [goTo, atFirstPage, tryPrevChapter, settings.mode, prefixLen, handleFlatPageChange]);
  const turnNext = useCallback(() => {
    if (swipeActiveRef.current) return; // stray tap at the end of a dismiss swipe
    if (!atLastPage()) {
      goTo(currentRef.current + 1, false);
      return;
    }
    const nextFlat = prefixLen + (pages?.length ?? 0);
    if (!IS_WEB && settings.mode === 'paged' && nextFlat < flatItems.length) {
      handleFlatPageChange(nextFlat);
      pagedRef.current?.goToPage(nextFlat, false);
      return;
    }
    tryAdvanceChapter();
  }, [goTo, atLastPage, tryAdvanceChapter, settings.mode, prefixLen, pages, flatItems.length, handleFlatPageChange]);

  // The bottom navigator's chapter-skip buttons: jump to the START of the
  // adjacent chapter, wherever in the current one you are. Distinct from
  // turnPrev/turnNext, which page one step and only reach a neighbouring chapter
  // by falling off an end.
  //
  // When the target is already stitched into the pager's window, jump inside it
  // (same relabel path a swipe crossing takes) instead of replacing the route —
  // a route replace would rebuild a window that already holds the destination.
  // Instant, not animated: sliding through a whole chapter to land on a jump
  // isn't a page turn.
  const skipChapter = useCallback(
    (delta: 1 | -1) => {
      showChrome();
      const targetId = (delta === 1 ? nextChapter : prevChapter)?.id;
      if (!IS_WEB && settings.mode === 'paged' && targetId) {
        const at = segments.findIndex((s) => s.id === targetId);
        if (at !== -1) {
          let flat = 0;
          for (let i = 0; i < at; i++) flat += segments[i]!.pages.length;
          handleFlatPageChange(flat);
          pagedRef.current?.goToPage(flat, false);
          return;
        }
      }
      void goAdjacentChapter(delta, 'first');
    },
    [showChrome, nextChapter, prevChapter, settings.mode, segments, handleFlatPageChange, goAdjacentChapter],
  );

  // Web keyboard nav: arrows (or A/D) page instantly like a tap (respecting
  // direction), Esc closes. Held-key repeat is driven by our own fixed-rate
  // interval rather than the browser's native key-repeat (which fires at an
  // uneven, often very fast OS-dependent rate) — that was visibly stuttering
  // the reader when a page turn's own work couldn't keep up with it.
  const navRepeatRef = useRef<{ key: string; id: ReturnType<typeof setInterval> } | null>(null);
  const NAV_REPEAT_MS = 180;
  const stopNavRepeat = useCallback(() => {
    if (navRepeatRef.current) {
      clearInterval(navRepeatRef.current.id);
      navRepeatRef.current = null;
    }
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Let the progress-pill's page-jump input handle its own arrow keys.
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === 'Escape') {
        router.back();
        e.preventDefault();
        return;
      }
      const isRight = e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D';
      const isLeft = e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A';
      if (!isRight && !isLeft) return;
      e.preventDefault();
      if (e.repeat) return; // our own interval below drives the repeat cadence
      // Right normally advances, Left retreats — both swap under RTL.
      const forward = isRight !== (settings.direction === 'rtl');
      const run = forward ? turnNext : turnPrev;
      run();
      stopNavRepeat();
      navRepeatRef.current = { key: e.key, id: setInterval(run, NAV_REPEAT_MS) };
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (navRepeatRef.current?.key === e.key) stopNavRepeat();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', stopNavRepeat);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stopNavRepeat);
      stopNavRepeat();
    };
  }, [router, turnPrev, turnNext, settings.direction, stopNavRepeat]);

  // Web: hovering the mouse near the top (toolbar) or bottom (progress pill /
  // settings gear) edge reveals the chrome and keeps it up for as long as the
  // cursor stays there (showChrome() re-arms the hide timer on every move
  // inside the band), mirroring hover-controls behavior in video players.
  // Outside the band it's a no-op, so it never fights the auto-hide timer
  // while the cursor just sits elsewhere on the page.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const HOVER_ZONE = 80; // px from the top/bottom edge
    const onMove = (e: MouseEvent) => {
      const inZone = e.clientY < HOVER_ZONE || e.clientY > window.innerHeight - HOVER_ZONE;
      if (inZone) showChrome();
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [showChrome]);

  return (
    <View style={styles.root}>
      {/* The reader's dark surface, as its own layer so it can fade with a
          swipe-away and reveal the screen behind (the route is a transparent
          modal — see _layout.tsx). Opaque at rest, so a normal reader looks
          unchanged. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <StatusBar style="light" hidden={!chromeVisible} />
      {error ? (
        <View style={styles.centerFill}>
          <RetryBlock message={error} onRetry={retry} />
        </View>
      ) : !pages ? (
        <View style={styles.centerFill}>
          <ThemedText style={styles.loadingText}>Loading…</ThemedText>
        </View>
      ) : (
        <>
          {/* Swipe-away dismissal on the cross axis: vertical while the paged
              reader scrolls horizontally, horizontal while the webtoon scrolls
              vertically. The page tracks the finger and fades; past the
              threshold it slides out and the reader closes. */}
          <SwipeDismiss
            axis={settings.mode === 'paged' ? 'vertical' : 'horizontal'}
            width={width}
            height={height}
            enabled={!readerZoomed}
            onDismiss={() => router.back()}
            progress={dismissProgress}
            onSwipeStart={beginSwipeGuard}
            onSwipeEnd={endSwipeGuard}
            onTouchBegin={pauseHide}>
            {settings.mode === 'paged' ? (
              <PagedReader
                ref={pagedRef}
                // Both pagers seed their position once, at mount, and neither can
                // re-seed reliably on its own — so remount them exactly when the
                // position they were seeded with stops meaning anything.
                //
                // Web: once per chapter. Its internal index only re-syncs when
                // `initialPage` (or the page count) changes, so advancing into a
                // chapter with the SAME number of pages — start already '0', n
                // unchanged — left it parked on the previous chapter's index
                // (visible whenever the next chapter was already prefetched, so
                // `pages` never blinked out to unmount it). Remounting also clears
                // the per-page failed/overflow state, which is likewise keyed on
                // the index changing.
                //
                // Native: once per RUN, not per chapter — a seamless crossing
                // stays inside the run and must NOT remount (that's the whole
                // point of relabelling via setParams), but landing outside it
                // rebuilds the stitched list wholesale, and only a remount lands
                // on the right page then.
                key={IS_WEB ? chapterId : `run:${runKey}`}
                // Native: the stitched multi-chapter flat list, so swiping across
                // a chapter boundary is an ordinary page turn. Web: per-chapter
                // (its pager hands boundary swipes to onPrev/onNext itself).
                pages={IS_WEB ? currentItems : flatItems}
                width={width}
                height={height}
                rtl={settings.direction === 'rtl'}
                pageFit={settings.pageFit}
                // Seed from `startIndex` (correct the instant `pages` lands, which
                // is the same render this mounts), NOT `currentPage` — that state
                // still reads 0 on this render (its pages-loaded correction effect
                // hasn't run yet), which left the native readers, which only seed
                // at mount and never re-sync, stuck on page 1 while the pill showed
                // the right number. Native seeds in flat terms; segments stitched
                // in after mount are handled by the pager's own key-anchored
                // re-scroll, not by re-seeding.
                initialPage={IS_WEB ? startIndex : prefixLen + startIndex}
                onPageChange={IS_WEB ? setCurrent : handleFlatPageChange}
                onVisiblePageChange={IS_WEB ? undefined : handleFlatVisiblePage}
                scrubTarget={scrubFlat}
                scrubbing={scrubbing}
                onPrev={turnPrev}
                onNext={turnNext}
                onToggleChrome={toggleChrome}
                onZoomChange={setReaderZoomed}
              />
            ) : (
              <WebtoonReader
                ref={webtoonRef}
                pages={pages}
                width={width}
                height={height}
                pageFit={settings.pageFit}
                // See PagedReader above: seed from `startIndex`, not the lagging
                // `currentPage` state, so the native readers land on the right page.
                initialPage={startIndex}
                onPageChange={setCurrent}
                onToggleChrome={toggleChrome}
                onZoomChange={setReaderZoomed}
                // The continuous variant advances via its end-of-chapter sentinel
                // (scroll-to-end or tap). The fit-page variant, whose page tracking
                // is exact, still uses the reliable `atLastPage` end-reached advance.
                nextChapterName={nextChapter?.name}
                onAdvance={() => void tryAdvanceChapter()}
                onEndReached={() => {
                  if (atLastPage()) void tryAdvanceChapter();
                }}
              />
            )}
          </SwipeDismiss>

          {/* Bottom chrome. Native gets the slider + chapter-skip navigator;
              web keeps the tap-to-jump progress pill (a pointer already has the
              keyboard and click-to-page, and there's no thumb to drag with).
              Fades out with the swipe too, so it doesn't hang in front of the
              fading page. `absoluteFill` + `box-none` so the absolutely-
              positioned bar inside still resolves against the full screen and
              taps pass through the gaps. */}
          <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeFadeStyle]}>
            {IS_WEB ? (
              <ProgressPill
                current={shown.page}
                total={shown.total}
                visible={chromeVisible}
                onJump={(i) => {
                  goTo(i);
                  showChrome();
                }}
                onEditingChange={holdChrome}
              />
            ) : (
              <ChapterNavigator
                page={shown.page}
                total={shown.total}
                // Only the paged reader has a direction; the webtoon one is vertical.
                rtl={settings.mode === 'paged' && settings.direction === 'rtl'}
                visible={chromeVisible}
                hasPrevChapter={!!prevChapter}
                hasNextChapter={!!nextChapter}
                onPrevChapter={() => skipChapter(-1)}
                onNextChapter={() => skipChapter(1)}
                // The drag itself moves the scroll offset directly (1:1 with the
                // finger, no animation); only the release settles, and the settle
                // animates because it's a short slide onto the nearest page.
                onScrub={scrubTo}
                // The paged reader takes the UI-thread path; the webtoon one
                // falls back to `onScrub` above.
                scrubTarget={settings.mode === 'paged' ? scrubFlat : undefined}
                offset={prefixLen}
                onSeek={seekTo}
                onScrubbingChange={handleScrubbing}
                // Fetch what the drag is heading for while it's still moving.
                onScrubPage={warmAround}
              />
            )}
          </Animated.View>
        </>
      )}
      {/* The toolbar sits OUTSIDE the loaded/error branch: back and settings stay
          reachable while pages are still loading or a fetch has failed. */}
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeFadeStyle]}>
        <ReaderToolbar
          title={seriesTitle ?? shown.name ?? 'Reader'}
          subtitle={seriesTitle ? (shown.name ?? '') : ''}
          visible={chromeVisible}
          onBack={() => router.back()}
          right={
            <SettingsControl
              bridgeId={bridgeId}
              seriesId={seed}
              title={cachedDetail?.title ?? title ?? seed}
              thumbnailUrl={cachedDetail?.cover}
              author={cachedDetail?.meta?.find((m) => m.label === 'AUTHOR')?.value}
              direct={isDirect}
            />
          }
        />
      </Animated.View>
    </View>
  );
}

/** The cached chapter list — deferred to the `getSeriesList` query for both real
 *  bridges and the mock (see the `chapters` derivation in the component, and
 *  series.tsx's matching read). */
function cachedChapters(qc: QueryClient, mock: boolean, bridgeId: string, seriesId: string): Chapter[] | undefined {
  return qc.getQueryData<SeriesListResult>(queryKeys.seriesList(mock, bridgeId, seriesId, false))?.chapters;
}

/**
 * The chapter adjacent to `chapterId` in reading order (`delta` +1 = next, -1 = prev).
 * Reading order is derived from the numeric chapter `number` via `getAdjacentChapter` —
 * not the raw array order, which a bridge never promises tracks reading order — and it
 * keeps the same scanlation group/language where the target has one (falling back to the
 * preferred group, then the freshest copy). Returns null when the current chapter isn't
 * in the list or is already at that end.
 */
function adjacentChapterFrom(chapters: Chapter[] | undefined, chapterId: string, delta: 1 | -1): Chapter | null {
  if (!chapters?.length) return null;
  const current = chapters.find((c) => c.id === chapterId);
  if (!current) return null;
  return getAdjacentChapter(chapters, current, delta, getPreferredGroup());
}

/** Next chapter's id from the warm cache only (no fetch) — used by the prefetch
 *  effect, where a miss is low severity and not worth a network round-trip. */
function nextChapterId(
  qc: QueryClient,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  chapterId: string,
): string | null {
  return adjacentChapterFrom(cachedChapters(qc, mock, bridgeId, seriesId), chapterId, 1)?.id ?? null;
}

/**
 * The adjacent chapter (`delta` +1 = next, -1 = prev), falling back to a real fetch
 * when the chapter list isn't cached (e.g. the reader was opened from History's Resume
 * action or a deep link, bypassing the series screen entirely — exactly the common case
 * chapter-to-chapter navigation needs to keep working for). Used only by the
 * navigation path; the cheaper prefetch stays cache-only, since a miss is low severity.
 */
async function resolveAdjacentChapter(
  qc: QueryClient,
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  delta: 1 | -1,
): Promise<Chapter | null> {
  const cached = adjacentChapterFrom(cachedChapters(qc, mock, bridgeId, seriesId), chapterId, delta);
  if (cached) return cached;
  try {
    const list = await qc.fetchQuery(seriesListQuery(ds, mock, bridgeId, seriesId, false, true));
    return adjacentChapterFrom(list.chapters, chapterId, delta);
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Transparent so a swipe-away can reveal the screen behind — the dark
    // surface is the `backdrop` layer below, which fades with the gesture.
    backgroundColor: 'transparent',
  },
  backdrop: {
    // Reference: `#reader-view { background: #0f0f0f }` — not pure black.
    backgroundColor: '#0f0f0f',
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#fff',
  },
});
