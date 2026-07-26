/**
 * Which top-level surface the Browse screen's Page selector is on.
 *
 * A page is a TAGGED value, never a bare string: the surfaces come from different namespaces (the
 * host's own built-ins, a bridge's `page: true` lists, the user's Comical custom pages) and nothing
 * stops them from colliding. A real bridge really does publish a list named "Home"; a user really can
 * name a custom page "Favorites". Tagging keeps each one distinct, and keying list pages by **id**
 * (not display name) means renaming a list can't strand the selection.
 *
 * The `Selector` takes plain strings, so a page crosses that boundary as an opaque, namespaced
 * `pageKey` (`home`, `favorites`, `list:<id>`, `custom:<id>`) with a `labels` map for display —
 * which is also why the selector shows "Popular" rather than the lowercased list name it used to.
 */
import type { CustomPage } from '@/data/custom-pages';
import type { BridgeList } from '@/data/types';

export type BrowsePage =
  /** The composed surface: a real bridge's non-`page` lists as rails + grids, or — for the synthetic
   *  Comical bridge — the cross-bridge aggregate. */
  | { kind: 'home' }
  /** A bridge's `page: true` list, browsed as a flat grid. */
  | { kind: 'list'; listId: string }
  /** Account favorites: one bridge's, or Comical's consolidated rails. */
  | { kind: 'favorites' }
  /** A user-composed Comical page. */
  | { kind: 'custom'; id: string };

/** Shared constant so "reset to Home" never allocates a fresh object (a new identity would
 *  re-render every consumer of the page state for no change). */
export const HOME_PAGE: BrowsePage = { kind: 'home' };

/** One entry in the Page selector: the opaque value it round-trips, and what the user reads. */
export type PageOption = { key: string; label: string };

const LIST_PREFIX = 'list:';
const CUSTOM_PREFIX = 'custom:';

/** The selector value for a page. Namespaced, so a bridge list with id `home` (or a custom page with
 *  id `favorites`) can't be mistaken for the built-in surface of that name. */
export function pageKey(page: BrowsePage): string {
  switch (page.kind) {
    case 'list':
      return LIST_PREFIX + page.listId;
    case 'custom':
      return CUSTOM_PREFIX + page.id;
    default:
      return page.kind;
  }
}

/** Inverse of `pageKey`. An unrecognised key falls back to Home rather than throwing — the selector's
 *  options are derived from live data, so a key can outlive the thing it named. */
export function parsePageKey(key: string): BrowsePage {
  if (key.startsWith(LIST_PREFIX)) return { kind: 'list', listId: key.slice(LIST_PREFIX.length) };
  if (key.startsWith(CUSTOM_PREFIX)) return { kind: 'custom', id: key.slice(CUSTOM_PREFIX.length) };
  if (key === 'favorites') return { kind: 'favorites' };
  return HOME_PAGE;
}

export const samePage = (a: BrowsePage, b: BrowsePage): boolean => pageKey(a) === pageKey(b);

/** A bridge has a composed Home only if it has at least one non-`page` list to build it from. Bridges
 *  whose lists are ALL page-flagged get no Home option at all — offering one would open an
 *  permanently empty surface. */
const hasComposedHome = (lists: BridgeList[]): boolean => lists.some((l) => !l.page);

const HOME_OPTION: PageOption = { key: 'home', label: 'Home' };
const FAVORITES_OPTION: PageOption = { key: 'favorites', label: 'Favorites' };

/**
 * Page selector options for a real bridge: its composed Home (when it has one), then each
 * `page: true` list in the order `getLists()` returned them, then Favorites.
 *
 * `favoritesAvailable` gates Favorites on the user actually being able to use it — a bridge
 * advertises the capability, but favorites need an account, so with no login set the page is hidden
 * rather than opening onto an auth error (see `useFavoritesAvailability`).
 *
 * Never returns empty: with no lists yet (still loading, or a failed fetch) the Home option stands in
 * so the selector still reads "Home" instead of a bare key.
 */
export function bridgePageOptions(
  lists: BridgeList[],
  capabilities: string[],
  favoritesAvailable = true,
): PageOption[] {
  const options: PageOption[] = [];
  if (hasComposedHome(lists)) options.push(HOME_OPTION);
  for (const l of lists) if (l.page) options.push({ key: pageKey({ kind: 'list', listId: l.id }), label: l.name });
  if (capabilities.includes('favorites') && favoritesAvailable) options.push(FAVORITES_OPTION);
  return options.length > 0 ? options : [HOME_OPTION];
}

/** Page selector options for the synthetic Comical bridge: its aggregate Home, the consolidated
 *  Favorites (only while a bridge qualifies), then the user's custom pages in their own order. */
export function comicalPageOptions(customPages: CustomPage[], favorites: boolean): PageOption[] {
  return [
    HOME_OPTION,
    ...(favorites ? [FAVORITES_OPTION] : []),
    ...customPages.map((p) => ({ key: pageKey({ kind: 'custom', id: p.id }), label: p.name })),
  ];
}

/**
 * The page a bridge opens on: the `page` list it marked `featured` (the contract's "surface this
 * prominently" flag — for a top-level page that means "open here"), else its composed Home, else its
 * first page list. A bridge with no lists at all lands on Home, which shows the load/retry state.
 */
export function defaultBridgePage(lists: BridgeList[]): BrowsePage {
  const featured = lists.find((l) => l.page && l.featured);
  if (featured) return { kind: 'list', listId: featured.id };
  if (hasComposedHome(lists)) return HOME_PAGE;
  const firstPage = lists.find((l) => l.page);
  return firstPage ? { kind: 'list', listId: firstPage.id } : HOME_PAGE;
}

/** Display labels keyed by selector value. Always carries the built-ins, so a selection whose option
 *  has since disappeared (favorites after a logout) still reads as a name, never a raw key. */
export function pageLabelMap(options: PageOption[]): Record<string, string> {
  const map: Record<string, string> = { home: HOME_OPTION.label, favorites: FAVORITES_OPTION.label };
  for (const o of options) map[o.key] = o.label;
  return map;
}
