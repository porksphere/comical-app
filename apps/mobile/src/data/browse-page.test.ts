import { describe, expect, test } from 'bun:test';

import {
  bridgePageOptions,
  comicalPageOptions,
  defaultBridgePage,
  HOME_PAGE,
  pageKey,
  pageLabelMap,
  parsePageKey,
  samePage,
  type BrowsePage,
} from './browse-page';
import type { CustomPage } from './custom-pages';
import type { BridgeList } from './types';

const list = (id: string, name: string, extra: Partial<BridgeList> = {}): BridgeList => ({
  id,
  name,
  page: false,
  ...extra,
});
/** A `page: true` list — a standalone top-level page rather than a home section. */
const pageList = (id: string, name: string, extra: Partial<BridgeList> = {}) =>
  list(id, name, { page: true, ...extra });

// The shapes the real bridges publish, since they're what the selector has to get right.
const PAGES_ONLY: BridgeList[] = [
  pageList('popular', 'Popular', { layout: 'grid', featured: true }),
  pageList('home', 'Home', { layout: 'grid', featured: false }),
];
const COMPOSED: BridgeList[] = [
  list('popular', 'Popular', { layout: 'grid', featured: true }),
  list('latest', 'Latest', { layout: 'carousel' }),
];

describe('pageKey / parsePageKey', () => {
  test('round-trips every kind', () => {
    const pages: BrowsePage[] = [
      HOME_PAGE,
      { kind: 'favorites' },
      { kind: 'list', listId: 'popular' },
      { kind: 'custom', id: 'abc123' },
    ];
    for (const p of pages) expect(parsePageKey(pageKey(p))).toEqual(p);
  });

  test('a list named like a built-in stays distinct from it', () => {
    // The collision that used to force the `id === 'home'` special case: a real bridge publishes a
    // list whose id AND name are "home", which must not be mistaken for the composed Home surface.
    const listPage: BrowsePage = { kind: 'list', listId: 'home' };
    expect(pageKey(listPage)).not.toBe(pageKey(HOME_PAGE));
    expect(parsePageKey(pageKey(listPage))).toEqual(listPage);
    expect(samePage(listPage, HOME_PAGE)).toBe(false);
  });

  test('an unrecognised key falls back to Home instead of throwing', () => {
    expect(parsePageKey('list-of-nonsense')).toEqual(HOME_PAGE);
    expect(parsePageKey('')).toEqual(HOME_PAGE);
  });
});

describe('bridgePageOptions', () => {
  test('a page-only bridge gets NO Home option — only its pages', () => {
    // Offering Home here would open a permanently empty surface: there are no non-page lists to
    // compose one from.
    expect(bridgePageOptions(PAGES_ONLY, [])).toEqual([
      { key: 'list:popular', label: 'Popular' },
      { key: 'list:home', label: 'Home' },
    ]);
  });

  test('a bridge with home sections gets Home first, in list order', () => {
    expect(bridgePageOptions([...COMPOSED, pageList('browse', 'Browse all')], [])).toEqual([
      { key: 'home', label: 'Home' },
      { key: 'list:browse', label: 'Browse all' },
    ]);
  });

  test('favorites is appended only when supported AND available', () => {
    const keys = (favoritesAvailable: boolean) =>
      bridgePageOptions(COMPOSED, ['favorites'], favoritesAvailable).map((o) => o.key);
    expect(keys(true)).toEqual(['home', 'favorites']);
    expect(keys(false)).toEqual(['home']);
    expect(bridgePageOptions(COMPOSED, []).map((o) => o.key)).toEqual(['home']);
  });

  test('falls back to Home with no lists (still loading, or a failed fetch)', () => {
    expect(bridgePageOptions([], [])).toEqual([{ key: 'home', label: 'Home' }]);
  });
});

describe('comicalPageOptions', () => {
  const custom: CustomPage[] = [
    { id: 'p1', name: 'Weekly', sections: [] },
    { id: 'p2', name: 'To read', sections: [] },
  ];

  test('Home, then Favorites when a bridge qualifies, then custom pages in order', () => {
    expect(comicalPageOptions(custom, true)).toEqual([
      { key: 'home', label: 'Home' },
      { key: 'favorites', label: 'Favorites' },
      { key: 'custom:p1', label: 'Weekly' },
      { key: 'custom:p2', label: 'To read' },
    ]);
    expect(comicalPageOptions(custom, false).map((o) => o.key)).toEqual(['home', 'custom:p1', 'custom:p2']);
  });
});

describe('defaultBridgePage', () => {
  test('a featured page list wins — the bridge opens on Popular, not its "home" list', () => {
    expect(defaultBridgePage(PAGES_ONLY)).toEqual({ kind: 'list', listId: 'popular' });
  });

  test('a featured NON-page list does not hijack the landing page', () => {
    // `featured` on a home section only picks the bridge's representative rail for the Comical
    // aggregate; the bridge still opens on its composed Home.
    expect(defaultBridgePage(COMPOSED)).toEqual(HOME_PAGE);
  });

  test('falls back to the first page list when nothing is featured and there is no Home', () => {
    expect(defaultBridgePage([pageList('a', 'A'), pageList('b', 'B')])).toEqual({ kind: 'list', listId: 'a' });
  });

  test('no lists at all lands on Home', () => {
    expect(defaultBridgePage([])).toEqual(HOME_PAGE);
  });
});

describe('pageLabelMap', () => {
  test('always resolves the built-ins, even for an option set that omits them', () => {
    const map = pageLabelMap(bridgePageOptions(PAGES_ONLY, []));
    expect(map['list:popular']).toBe('Popular');
    // Favorites isn't an option here, but a selection left over from a logged-in session must still
    // read as a name rather than a raw key.
    expect(map.favorites).toBe('Favorites');
    expect(map.home).toBe('Home');
  });
});
