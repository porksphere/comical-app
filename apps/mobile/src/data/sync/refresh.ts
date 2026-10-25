/**
 * What a sync round refetches. A round that only moved library records (progress, activity,
 * collections) can't change anything a bridge serves, so it leaves bridge content alone — refetching
 * it anyway is every Home rail and open page list hitting its source each time a phone syncs.
 * Registry and settings records do change what bridges serve, so those rounds refresh everything.
 *
 * A skip list rather than an allowlist on purpose: a key added later and not listed here is
 * refetched, which is only wasteful, where a missing allowlist entry would leave synced data stale.
 */
import { LIBRARY_TABLES } from '@comical/sync';
import type { QueryClient } from '@tanstack/react-query';

import { bumpDataEpoch } from '../data-epoch';

const LIBRARY = new Set<string>(LIBRARY_TABLES);

const BRIDGE_CONTENT = new Set([
  'seriesDetail',
  'seriesList',
  'chapterPages',
  'directPages',
  'pageThumb',
  'isFavorite',
  'relatedGroups',
  'homeSections',
  'bridgeFeaturedRail',
  'bridgeFavoritesRail',
  'bridgeSearchRail',
  'customSectionPage',
  'bridgeLists',
  'bridgeFilters',
  'bridgeSortOptions',
  'tagSearch',
  'browseGrid',
  'trackerCatalogSearch',
  'registryBridges',
  'registryTrackers',
  'appUpdateCheck',
]);

/** `tables` undefined is a hub too old to say, which can't be told apart from "everything". */
export function refreshAfterSync(client: QueryClient, tables: readonly string[] | undefined): void {
  if (tables === undefined || tables.some((t) => !LIBRARY.has(t))) {
    bumpDataEpoch();
    void client.invalidateQueries();
    return;
  }
  void client.invalidateQueries({ predicate: (q) => !BRIDGE_CONTENT.has(q.queryKey[0] as string) });
}
