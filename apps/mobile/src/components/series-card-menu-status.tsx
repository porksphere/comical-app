import { useCallback, useEffect, useRef, useState } from 'react';

import type { SeriesEntry } from '@/data/types';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';

/**
 * The favorite/library status of a card's series, plus the toggles to change it. Shared by all three
 * `SeriesCardMenu` platform variants (native/iOS/web) so the deferral below is written once.
 *
 * Why this exists: the two status queries (`useFavorite` + `useLibrary`) used to run on EVERY
 * `SeriesCard` render — each is a react-query `useQuery` that creates a cache observer even when
 * `enabled: false`, and on every recycle the `entry.id` changes so both observers re-key. Across a
 * fast-scrolling recycled grid that's pure overhead on the scroll hot path. Now the hooks live in
 * `SeriesCardMenuStatus`, which a menu mounts ONLY once its card is armed (first press-in / hover),
 * so untouched cards create zero status observers. The menu stays mounted so the native long-press
 * still opens on the first try — only the queries are deferred.
 */
export type MenuStatus = { favorited: boolean | null; inLibrary: boolean | null };
export type MenuToggles = { favorite: () => void; library: () => void };

const NOOP = () => {};

/**
 * State + plumbing a menu variant holds so it can be fed by an armed-gated `SeriesCardMenuStatus`.
 * `status` drives the menu labels/checkmarks; `togglesRef` carries the (identity-unstable) toggle
 * callbacks without re-rendering the menu; `onStatus` is a stable, equality-guarded setter.
 */
export function useCardMenuStatus() {
  const [status, setStatus] = useState<MenuStatus>({ favorited: null, inLibrary: null });
  const togglesRef = useRef<MenuToggles>({ favorite: NOOP, library: NOOP });
  const onStatus = useCallback((favorited: boolean | null, inLibrary: boolean | null) => {
    setStatus((prev) => (prev.favorited === favorited && prev.inLibrary === inLibrary ? prev : { favorited, inLibrary }));
  }, []);
  return { status, togglesRef, onStatus };
}

/**
 * Runs the two status queries and reports results up. Renders nothing. Mount it only when a card is
 * armed (see `useCardMenuStatus`) — that's what keeps unengaged, scrolling cards free of observers.
 */
export function SeriesCardMenuStatus({
  bridgeId,
  entry,
  onStatus,
  togglesRef,
}: {
  bridgeId: string;
  entry: SeriesEntry;
  onStatus: (favorited: boolean | null, inLibrary: boolean | null) => void;
  togglesRef: React.MutableRefObject<MenuToggles>;
}) {
  const { favorited, toggle: toggleFavorite } = useFavorite(bridgeId, entry.id);
  const { inLibrary, toggle: toggleLibrary } = useLibrary(bridgeId, entry.id, () => ({
    title: entry.title,
    ...(entry.cover ? { thumbnailUrl: entry.cover } : {}),
  }));
  // Toggles are recreated each render (not memoized in the hooks); a ref carries them so the menu
  // reads the latest without re-rendering on their identity churn.
  togglesRef.current = { favorite: toggleFavorite, library: toggleLibrary };
  useEffect(() => {
    onStatus(favorited, inLibrary);
  }, [favorited, inLibrary, onStatus]);
  return null;
}
