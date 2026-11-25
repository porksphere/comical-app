import { useCallback } from 'react';

import { activityLabel } from '@/data/activity/feed-rows';
import { useWarmChapterPages, useWarmSeriesDetail } from '@/data/prefetch';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import type { BookshelfEntry } from '@/hooks/use-home-bookshelf';
import { historySub } from '@/lib/history-sub';
import { activityReadParams, historyResumeParams, seriesDetailParams } from '@/lib/series-links';

type Push = { warm: () => void; params: Record<string, string> };

export type ShelfOpening = {
  bridgeName: string;
  /** Whether reading it carries on where it was left, rather than starting on a new chapter. */
  resumes: boolean;
  /** Where reading it goes, in a few words, and spelled out with when it was left. */
  where: string;
  detail: string;
  /** The reader. None for a series with neither a place it was left nor a chapter waiting. */
  read: Push | null;
  /** Its details page. */
  details: Push;
};

/**
 * What one of Comical Home's series opens, and what it says of itself: what the History tab's row
 * opens and says for a series that has been read, and the Activity tab's for one that has only its
 * new chapters. Worked out in one place for the shelf and the heroes on trial beside it, so none
 * of them can say or open something those tabs don't. Each push comes with what warms it, from the
 * same values it puts in its params.
 */
export function useShelfOpening(): (entry: BookshelfEntry) => ShelfOpening {
  const { nameOf, directOf } = useBridgeMap();
  const warmPages = useWarmChapterPages();
  const warmDetail = useWarmSeriesDetail();
  return useCallback(
    (entry) => {
      const { history: h, news: g, bridgeId, seriesId } = entry;
      const bridge = { name: nameOf(bridgeId), direct: directOf(bridgeId) };
      const details: Push = {
        warm: () => warmDetail(bridgeId, seriesId, { direct: bridge.direct, bridgeName: bridge.name, title: entry.title, cover: entry.thumbnailUrl }),
        params: seriesDetailParams(entry, bridge),
      };
      const read = (): Push | null => {
        if (h) {
          const direct = h.chapterId === DIRECT_CHAPTER_ID || !h.chapterId;
          return { warm: () => warmPages(bridgeId, seriesId, direct ? undefined : h.chapterId, h.lastPage ?? 0), params: historyResumeParams(h, bridge.name) };
        }
        if (!g) return null;
        // An Activity row with no chapter to name opens the details, as its own tab's row does.
        if (g.chapterId === undefined) return { warm: details.warm, params: activityReadParams(g, bridge) };
        const chapterId = g.chapterId;
        return { warm: () => warmPages(bridgeId, seriesId, chapterId, 0), params: activityReadParams(g, bridge) };
      };
      const where = h ? historySub(h, { withTime: false, long: false }) : g ? activityLabel(g, bridge.name) : '';
      return {
        bridgeName: bridge.name,
        resumes: !!h,
        where,
        detail: h ? historySub(h, { withTime: true, long: true }) : where,
        read: read(),
        details,
      };
    },
    [nameOf, directOf, warmPages, warmDetail],
  );
}
