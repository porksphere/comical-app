import { useState, type RefObject } from 'react';
import type { ViewInstance } from 'react-native';

import { useShelfOpening } from '@/components/home-bookshelf/opening';
import { useZoomHref, withZoomSource } from '@/components/zoom-source';
import type { BookshelfEntry } from '@/hooks/use-home-bookshelf';
import { useRouter } from '@/lib/nav';
import { useIsZoomingSeries, useZoomOriginSource, useZoomSurfaceKey } from '@/lib/series-zoom';

/**
 * What the series in front of a hero opens, and the zoom it opens with: the series page grows out
 * of the hero's picture of it and goes back into it, as it does out of a card, whether it is read
 * or its details are opened.
 *
 * Off iOS that is the app's own zoom, whose rect is measured off the picture's view (`sourceRef`,
 * the caller's) as the finger comes down (`pressIn`, which also warms the fetch). On iOS it is the
 * system's, out of a `ZoomSource` laid over the picture (`zoomHref`, `onZoomId`). `radius` is the
 * picture's corner. The picture is `flying` while a copy of it is in the air, and is not to be
 * drawn then.
 *
 * The hero is a zoom surface of its own, by name. Under the feed's it would be asked for by the
 * feed's rows, which don't hold it, and the page would be told its source had gone.
 */
export function useHeroOpen(entry: BookshelfEntry | undefined, sourceRef: RefObject<ViewInstance | null>, radius: number) {
  const router = useRouter();
  const openingOf = useShelfOpening();
  const surface = useZoomSurfaceKey('home-hero');
  const seriesId = entry?.seriesId ?? '';
  const capture = useZoomOriginSource(seriesId, surface, sourceRef, radius, !!entry);
  const flying = useIsZoomingSeries(seriesId, surface);
  // In state where a list's rows keep theirs in a ref: there is one hero, and its handlers are
  // made here, where a ref may not be read.
  const [zoomId, onZoomId] = useState<string | null>(null);
  const zoomHref = useZoomHref('/series');
  if (!entry) return null;

  const opening = openingOf(entry);
  const reads = opening.read ?? opening.details;
  const push = (params: Record<string, string>) => router.push({ pathname: '/series', params: withZoomSource(params, zoomId) });
  return {
    opening,
    flying,
    zoomHref,
    onZoomId,
    pressIn: (what: 'read' | 'details') => {
      capture();
      (what === 'read' ? reads : opening.details).warm();
    },
    // The reader is told it was zoomed into from a cover, as a History or Activity row tells it.
    read: () => push({ ...reads.params, ...(zoomId && entry.thumbnailUrl && reads.params.reader === '1' ? { zoomFrom: 'cover' } : {}) }),
    details: () => push(opening.details.params),
  };
}
