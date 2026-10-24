import { useCallback, useEffect, useRef } from 'react';

import type { Size } from '@/components/reader/page-geometry';
import { DETECT_MAX_PAGES, DETECT_MIN_PAGES, looksLikeWebtoon } from '@/components/reader/webtoon-detection';
import { showToast } from '@/components/toast';
import { peekSeriesReaderMode, setSeriesReaderMode } from '@/hooks/use-reader-settings';

// Series judged this session. A verdict either way is final for the session: a series found to be
// a webtoon has its own mode now, and one that wasn't after DETECT_MAX_PAGES shapes is not asked
// again on every chapter.
const judged = new Set<string>();

/**
 * Feeds page sizes from the paged reader into `looksLikeWebtoon`, and the moment a series passes,
 * gives it its own vertical mode (`setSeriesReaderMode`, as `auto`) and says so. Only while
 * `enabled` — paged mode, and the series without a mode of its own — and only for a series not yet
 * judged. The callback is stable, so a pager can take it as a prop without churn.
 */
export function useWebtoonDetection(seriesKey: string | null, enabled: boolean): (key: string, size: Size) => void {
  const seen = useRef(new Map<string, Size>());
  const live = useRef({ seriesKey, enabled });
  useEffect(() => {
    live.current = { seriesKey, enabled };
  });
  return useCallback((key: string, size: Size) => {
    const { seriesKey, enabled } = live.current;
    if (!enabled || !seriesKey || judged.has(seriesKey) || peekSeriesReaderMode(seriesKey)) return;
    seen.current.set(key, size);
    const sizes = [...seen.current.values()];
    if (sizes.length < DETECT_MIN_PAGES) return;
    if (looksLikeWebtoon(sizes)) {
      judged.add(seriesKey);
      setSeriesReaderMode(seriesKey, { mode: 'webtoon', by: 'auto' });
      showToast('Switched to vertical reading for this series');
    } else if (sizes.length >= DETECT_MAX_PAGES) judged.add(seriesKey);
  }, []);
}
