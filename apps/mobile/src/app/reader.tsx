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
import { chapterPagesQuery, directPagesQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { SeriesDetail } from '@/data/types';
import { useReaderSettings } from '@/hooks/use-reader-settings';

// Full-screen page reader. Resolves a page-URL list from route params and
// renders either the horizontal Paged reader or the vertical Webtoon reader,
// with auto-hiding chrome (toolbar, progress pill, settings) layered on top.
// Always dark — the reader is its own black surface, not a ThemedView.

const CHROME_HIDE_MS = 3000;
// How many upcoming page images to warm ahead of the reader's position, and how
// close to the end before the next chapter's pages are prefetched — restores
// comical-web's `prefetchAhead` / `prefetchNextChapter` reading smoothness.
const PREFETCH_AHEAD = 4;
const NEXT_CHAPTER_TRIGGER = 3;

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

  const startIndex = useMemo(
    () => Math.max(0, Math.min((pages?.length ?? 1) - 1, Number(start ?? 0) || 0)),
    [pages, start],
  );

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
  // next chapter's page list into the query cache so opening it is instant.
  useEffect(() => {
    if (!pages || pages.length === 0) return;
    const ahead = pages.slice(currentPage + 1, currentPage + 1 + PREFETCH_AHEAD);
    if (ahead.length) void Image.prefetch(ahead);

    if (!chapterId || currentPage < pages.length - NEXT_CHAPTER_TRIGGER) return;
    const nextId = nextChapterId(queryClient, mock, bridgeId ?? '', seed ?? '', chapterId);
    if (nextId) {
      void queryClient.prefetchQuery(chapterPagesQuery(ds, mock, bridgeId ?? '', seed ?? '', nextId));
    }
  }, [pages, currentPage, chapterId, ds, mock, queryClient, bridgeId, seed]);

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
  const prev = useCallback(() => goTo(currentRef.current - 1), [goTo]);
  const next = useCallback(() => goTo(currentRef.current + 1), [goTo]);
  // Tapping a page turns it instantly (no slide), on every platform; keyboard
  // arrows and progress-pill jumps keep the animated transition.
  const turnPrev = useCallback(() => goTo(currentRef.current - 1, false), [goTo]);
  const turnNext = useCallback(() => goTo(currentRef.current + 1, false), [goTo]);

  // Web keyboard nav: arrows page (respecting direction), Esc closes.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.back();
      else if (e.key === 'ArrowRight') (settings.direction === 'rtl' ? prev : next)();
      else if (e.key === 'ArrowLeft') (settings.direction === 'rtl' ? next : prev)();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, prev, next, settings.direction]);

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
              initialPage={currentPage}
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
              initialPage={currentPage}
              onPageChange={setCurrent}
              onToggleChrome={toggleChrome}
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
          />
        </>
      )}
      <SettingsControl visible={chromeVisible} />
    </View>
  );
}

/**
 * The chapter to read after `chapterId`, resolved from the cached series detail
 * if it's warm (i.e. the reader was opened from the series screen). Series detail
 * lists chapters newest-first — the Read button starts at the last element — so
 * the next chapter in reading order sits one index earlier. Returns null when the
 * detail isn't cached or the current chapter is already the newest.
 */
function nextChapterId(
  qc: QueryClient,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  chapterId: string,
): string | null {
  const detail = qc.getQueryData<SeriesDetail>(queryKeys.seriesDetail(mock, bridgeId, seriesId, false));
  const chapters = detail?.chapters;
  if (!chapters?.length) return null;
  const i = chapters.findIndex((c) => c.id === chapterId);
  if (i <= 0) return null;
  return chapters[i - 1].id;
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
