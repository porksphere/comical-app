import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { PagedReader, type PagedReaderHandle } from '@/components/reader/paged-reader';
import { ProgressPill } from '@/components/reader/progress-pill';
import { ReaderToolbar } from '@/components/reader/reader-toolbar';
import { SettingsControl } from '@/components/reader/settings-panel';
import { WebtoonReader, type WebtoonReaderHandle } from '@/components/reader/webtoon-reader';
import { readerPagesForChapter, readerPagesForDirect } from '@/data/mock';
import { useReaderSettings } from '@/hooks/use-reader-settings';

// Full-screen page reader. Resolves a page-URL list from route params and
// renders either the horizontal Paged reader or the vertical Webtoon reader,
// with auto-hiding chrome (toolbar, progress pill, settings) layered on top.
// Always dark — the reader is its own black surface, not a ThemedView.

const CHROME_HIDE_MS = 3000;

export default function ReaderScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { seed, title, chapterId, chapterName, start } = useLocalSearchParams<{
    seed?: string;
    title?: string;
    direct?: string;
    chapterId?: string;
    chapterName?: string;
    start?: string;
  }>();

  const pages = useMemo(
    () => (chapterId ? readerPagesForChapter(chapterId) : readerPagesForDirect(seed ?? 'series')),
    [chapterId, seed],
  );
  const startIndex = Math.max(0, Math.min(pages.length - 1, Number(start ?? 0) || 0));

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
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      setCurrent(clamped);
      if (settings.mode === 'paged') pagedRef.current?.goToPage(clamped, animated);
      else webtoonRef.current?.goToPage(clamped);
    },
    [pages.length, settings.mode, setCurrent],
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
      <SettingsControl visible={chromeVisible} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
});
