/**
 * Best-effort derivation of a bridge's implemented method names from its declared capabilities —
 * the fallback used when the native `initBridge` doesn't report an explicit `methods` list.
 *
 * The authoritative source is the native side: `@comical/core`'s `loadBridge` wraps only the
 * methods a bridge actually defines, so a native build that returns `{ info, methods }` from
 * `comical_init` lets `buildProxyBridge` expose exactly those. This map keeps the runtime working
 * against older native builds and mirrors the capability tags in
 * comical/packages/contract/src/bridge.ts — keep the two in lockstep.
 */
import type { BridgeInfo } from '@comical/contract';

const CAPABILITY_METHODS: Record<string, string[]> = {
  settings: ['getSettings'],
  lists: ['getLists', 'getListItems'],
  search: ['getSearchResults'],
  filters: ['getFilters', 'getTags'],
  sort: ['getSortOptions'],
  favorites: ['getFavorites', 'addFavorite', 'removeFavorite', 'isFavorite'],
  'exclude-genres': ['getGenreExclusions', 'setExcludedGenres'],
  'resolve-tags': ['resolveTags'],
  'related-series': ['getRelatedSeries'],
  // The "direct" (chapterless) reader surface. Chaptered series use getChapters/getChapterPages,
  // added unconditionally below since they have no dedicated capability tag.
  direct: ['getSeriesPages', 'resolvePage', 'getPageThumbnail'],
};

// getSeriesDetails is mandatory (non-optional in the Bridge contract); chapter reading has no
// capability tag, so a non-"direct" bridge is assumed to serve chapters.
const ALWAYS = ['getSeriesDetails'];
const CHAPTERED = ['getChapters', 'getChapterPages'];

/** The method names to expose on a proxy for a bridge with the given `info.capabilities`. */
export function methodsForBridge(info: BridgeInfo): string[] {
  const caps = info.capabilities ?? [];
  const methods = new Set<string>(ALWAYS);
  for (const cap of caps) for (const m of CAPABILITY_METHODS[cap] ?? []) methods.add(m);
  if (!caps.includes('direct')) for (const m of CHAPTERED) methods.add(m);
  return [...methods];
}
