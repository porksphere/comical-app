import { useMemo } from 'react';

import { useHideNsfw } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';

/**
 * Drop anything belonging to an NSFW bridge while NSFW is off.
 *
 * Every cross-bridge list of the user's own data needs this — the library grid, history, activity,
 * a collection's contents, and the reader album built from one. The rule is always the same (the
 * ITEM's bridge decides, since these lists span bridges), and it was open-coded on each surface,
 * which is how a collection came to show NSFW series with NSFW disabled: the surface was new and
 * simply didn't have the line. One hook so a new surface inherits it instead of re-deriving it.
 *
 * Filtering here rather than in the query is deliberate. NSFW visibility is a device preference,
 * not part of the fetch, so folding it into `queryFn` would key the cache without it and serve a
 * list built under the old setting until something invalidated it — and the session-scoped modes
 * (`until-background`, `until-restart`) flip without any write to invalidate on.
 *
 * An unknown bridge — uninstalled, or the map still loading — is treated as SAFE and kept. Hiding
 * on unknown would blank the whole library for the first frames after launch, and the bridge list
 * is served from cache almost immediately.
 */
export function useVisibleByBridge<T extends { bridgeId: string }>(items: T[] | undefined): T[] {
  const hideNsfw = useHideNsfw();
  const { byId } = useBridgeMap();
  return useMemo(() => {
    if (!items) return [];
    if (!hideNsfw) return items;
    return items.filter((i) => !byId.get(i.bridgeId)?.nsfw);
  }, [items, hideNsfw, byId]);
}
