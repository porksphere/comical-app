import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { PagedReader, type PagedReaderHandle } from '@/components/reader/paged-reader';
import { ProgressPill } from '@/components/reader/progress-pill';
import { ReaderToolbar } from '@/components/reader/reader-toolbar';
import { SettingsControl } from '@/components/reader/settings-panel';
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
import { getAdjacentChapter } from '@/lib/chapter-order';
import { getPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';
import { useReaderSettings } from '@/hooks/use-reader-settings';

// Full-screen page reader. Resolves a page-URL list from route params and
// renders either the horizontal Paged reader or the vertical Webtoon reader,
// with auto-hiding chrome (toolbar, progress pill, settings) layered on top.
// Always dark — the reader is its own black surface, not a ThemedView.

const CHROME_HIDE_MS = 3000;
// How close to the end of a chapter before the next chapter's pages are
// prefetched — restores comical-web's `prefetchNextChapter` reading smoothness.
// (How many page *images* to warm ahead is the user-configurable
// `settings.prefetchAhead`, comical-web's `prefetchAhead`.)
const NEXT_CHAPTER_TRIGGER = 3;

/** Warm expo-image's cache for a small window of upcoming pages. `pages` are now raw (unresolved)
 *  paths, so resolve them first (deduped/cached, shared with ReaderPage's own lazy resolve) and only
 *  prefetch the http(s) results — a `data:` URI is already inlined, nothing to fetch. Best-effort:
 *  failures are the per-page ReaderPage's problem to surface, not the prefetch's. */
function warmPrefetch(pages: string[]): void {
  if (!pages.length) return;
  void Promise.all(pages.map((p) => resolveAssetSourceCached(p).catch(() => null))).then((urls) => {
    const http = urls.filter((u): u is string => !!u && !u.startsWith('data:'));
    if (http.length) void Image.prefetch(http);
  });
}

export default function ReaderScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { seed, title, bridgeId, chapterId, chapterName, start } = useLocalSearchParams<{
    seed?: string;
    title?: string;
    bridgeId?: string;
    chapterId?: string;
    chapterName?: string;
    start?: string;
  }>();

  // Cached page fetch: reopening a chapter (or coming back to it) repaints from
  // the query cache instead of refetching, and next-chapter prefetch below can
  // pre-populate this same cache so the following chapter opens instantly.
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const {
    data: pages = null,
    error: queryError,
    refetch,
  } = useQuery(
    chapterId
      ? chapterPagesQuery(ds, mock, bridgeId ?? '', seed ?? '', chapterId)
      : directPagesQuery(ds, mock, bridgeId ?? '', seed ?? ''),
  );
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
  const [chromeVisible, setChromeVisible] = useState(true);

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
  useEffect(() => {
    if (!pages || pages.length === 0) return;
    const ahead = pages.slice(currentPage + 1, currentPage + 1 + settings.prefetchAhead);
    warmPrefetch(ahead);

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
  }, [pages, currentPage, chapterId, ds, mock, queryClient, bridgeId, seed, settings.prefetchAhead]);

  // ── Auto-advance to the next chapter ──────────────────────────────────────
  // Guards against a re-entrant double-advance (e.g. a rapid extra tap/scroll
  // past the end before the new chapter's pages have landed). Cleared once a
  // new `pages` list lands — either the auto-advance's own navigation, or any
  // other chapter change — so a later chapter-end can advance again.
  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [pages]);

  // Move to the adjacent chapter in reading order: `delta` +1 = next (land on its
  // first page), -1 = previous (land on its last page, so paging back is continuous).
  const goAdjacentChapter = useCallback(
    async (delta: 1 | -1) => {
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
        start: delta === 1 ? '0' : 'last',
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

  // The chapter list is deferred to a separate `getSeriesList` fetch (both real bridges
  // and the mock — see series.tsx's matching `listData?.chapters`). Subscribe to it so
  // it's present even on a cold open (History/Resume, deep link) — otherwise the reader
  // can't resolve the next chapter and advance silently no-ops.
  const { data: listData } = useQuery(
    seriesListQuery(ds, mock, bridgeId ?? '', seed ?? '', false, !!seed && !!chapterId),
  );
  const chapters = listData?.chapters;

  // Remember the scanlation group of the chapter being read, so next/prev keeps the
  // same source — including when the reader was opened from History/a deep link
  // (bypassing the chapter list, which otherwise sets this). Mirrors comical-web's
  // `openChapter`: only set when the chapter actually carries a group; never clear it.
  useEffect(() => {
    if (!chapterId) return;
    const group = chapters?.find((c) => c.id === chapterId)?.group;
    if (group !== undefined) setPreferredGroup(group);
  }, [chapterId, chapters]);

  // The next chapter in reading order — drives the webtoon end-of-chapter sentinel.
  // Resolved from the combined chapter list (`chapters`), which subscribes to the
  // deferred `getSeriesList` for real bridges; a still-cold list just omits the
  // sentinel, and the scroll/tap auto-advance re-resolves via a fetch
  // (`resolveNextChapter`).
  const nextChapter = useMemo(() => {
    if (!chapterId || !chapters) return null;
    const current = chapters.find((c) => c.id === chapterId);
    return current ? getAdjacentChapter(chapters, current, 1, getPreferredGroup()) : null;
  }, [chapterId, chapters]);

  // Kept in a ref (reassigned every render) so the debounce + unmount-flush
  // effects below always record the latest page/membership without re-subscribing.
  const recordRef = useRef<() => void>(() => {});
  recordRef.current = () => {
    if (!bridgeId || !seed || !pages || pages.length === 0 || inLibrary === undefined) return;
    const lastPage = currentRef.current;
    const pageCount = pages.length;
    if (chapterId && inLibrary) {
      void ds
        .recordChapterProgress(bridgeId, seed, chapterId, {
          lastPage,
          pageCount,
          ...(chapterName ? { chapterName } : {}),
        })
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

  // Auto-hide chrome; any toggle/show resets the timer.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
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
  const toggleChrome = useCallback(() => {
    setChromeVisible((v) => {
      const nextVisible = !v;
      if (nextVisible) scheduleHide();
      else if (hideTimer.current) clearTimeout(hideTimer.current);
      return nextVisible;
    });
  }, [scheduleHide]);

  const goTo = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min((pages?.length ?? 1) - 1, index));
      setCurrent(clamped);
      if (settings.mode === 'paged') pagedRef.current?.goToPage(clamped, animated);
      else webtoonRef.current?.goToPage(clamped);
    },
    [pages, settings.mode, setCurrent],
  );
  const atLastPage = useCallback(() => !!pages && currentRef.current >= pages.length - 1, [pages]);
  const atFirstPage = useCallback(() => currentRef.current <= 0, []);
  // Tapping a page and keyboard navigation both turn instantly (no slide), on
  // every platform; only the progress-pill jump keeps the animated transition.
  const turnPrev = useCallback(() => {
    if (atFirstPage()) {
      tryPrevChapter();
      return;
    }
    goTo(currentRef.current - 1, false);
  }, [goTo, atFirstPage, tryPrevChapter]);
  const turnNext = useCallback(() => {
    if (atLastPage()) {
      tryAdvanceChapter();
      return;
    }
    goTo(currentRef.current + 1, false);
  }, [goTo, atLastPage, tryAdvanceChapter]);

  // Web keyboard nav: arrows (or A/D) page instantly like a tap (respecting
  // direction), Esc closes.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.back();
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D')
        (settings.direction === 'rtl' ? turnPrev : turnNext)();
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A')
        (settings.direction === 'rtl' ? turnNext : turnPrev)();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, turnPrev, turnNext, settings.direction]);

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
          {settings.mode === 'paged' ? (
            <PagedReader
              ref={pagedRef}
              pages={pages}
              width={width}
              height={height}
              rtl={settings.direction === 'rtl'}
              pageFit={settings.pageFit}
              // Seed from `startIndex` (correct the instant `pages` lands, which
              // is the same render this mounts), NOT `currentPage` — that state
              // still reads 0 on this render (its pages-loaded correction effect
              // hasn't run yet), which left the native readers, which only seed
              // at mount and never re-sync, stuck on page 1 while the pill showed
              // the right number.
              initialPage={startIndex}
              onPageChange={setCurrent}
              onPrev={turnPrev}
              onNext={turnNext}
              onToggleChrome={toggleChrome}
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

          <ReaderToolbar
            title={chapterName ?? title ?? 'Reader'}
            subtitle={`Page ${currentPage + 1} of ${pages.length}`}
            visible={chromeVisible}
            onBack={() => router.back()}
          />
          <ProgressPill
            current={currentPage}
            total={pages.length}
            visible={chromeVisible}
            onJump={(i) => {
              goTo(i);
              showChrome();
            }}
            onEditingChange={(editing) => {
              if (editing) {
                if (hideTimer.current) clearTimeout(hideTimer.current);
              } else {
                scheduleHide();
              }
            }}
          />
        </>
      )}
      <SettingsControl
        visible={chromeVisible}
        bridgeId={bridgeId}
        seriesId={seed}
        title={cachedDetail?.title ?? title ?? seed}
        thumbnailUrl={cachedDetail?.cover}
        author={cachedDetail?.meta?.find((m) => m.label === 'AUTHOR')?.value}
      />
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
