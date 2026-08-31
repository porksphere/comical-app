import type { LegendListRef } from '@legendapp/list/react-native';
import { useCallback, useEffect, type RefObject } from 'react';

import { traceJS } from '@/lib/gesture-trace';
import {
  notifyZoomSurfaceChanged,
  useZoomSurfaceLocator,
  useZoomSurfaceMembership,
  useZoomSurfaceReveal,
  type ZoomSourceKey,
} from '@/lib/series-zoom';

/**
 * A LegendList as a zoom surface: where it has an item, how to bring it into view, and the notice
 * that its order changed. `lib/series-zoom` owns those three contracts and knows nothing about any
 * particular list; this is the adapter that implements them from `getState()`.
 *
 * `seriesIdOf` has to be stable — a module-level function, not an inline arrow — or every render
 * re-registers all three.
 */
export function useZoomSurfaceList<T>(
  surface: ZoomSourceKey,
  items: readonly T[] | undefined,
  seriesIdOf: (item: T) => string,
  listRef: RefObject<LegendListRef | null>,
): void {
  const indexOf = useCallback(
    (seriesId: string) => items?.findIndex((item) => seriesIdOf(item) === seriesId) ?? -1,
    [items, seriesIdOf],
  );

  useZoomSurfaceReveal(
    surface,
    useCallback(
      (seriesId: string) => {
        const index = indexOf(seriesId);
        // -1 means this list no longer holds the series at all — nothing to scroll to.
        traceJS('zoom', 'reveal.idx', { i: index, n: items?.length ?? 0 });
        // Centred, so the card clears the top bar and the tab bar whichever way it drifted out.
        if (index >= 0) listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      },
      [indexOf, items, listRef],
    ),
  );

  // Cheaper than `locate` and answerable when it isn't — see `zoomSourceHolds`. Registered from the
  // same `indexOf`, so a list can never say it has an item it can't find.
  useZoomSurfaceMembership(
    surface,
    useCallback((seriesId: string) => indexOf(seriesId) >= 0, [indexOf]),
  );

  useZoomSurfaceLocator(
    surface,
    useCallback(
      (seriesId: string) => {
        const index = indexOf(seriesId);
        const state = index >= 0 ? listRef.current?.getState() : undefined;
        const contentY = state?.positionAtIndex(index);
        return state && contentY !== undefined ? { contentY, scroll: state.scroll } : null;
      },
      [indexOf, listRef],
    ),
  );

  useEffect(() => {
    notifyZoomSurfaceChanged(surface);
  }, [items, surface]);
}
