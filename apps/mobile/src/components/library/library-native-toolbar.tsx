import { Stack } from 'expo-router';

import { collectedSortMenu } from '@/components/collections/collected-sort-button';
import { libraryFilterMenu, libraryFilterNarrowing, useLibraryFilterState } from '@/components/library-filter-button';
import { librarySortMenu } from '@/components/library-sort-button';
import {
  type LeadingMenuProps,
  type LeadingMenuSection,
  NavBarLeadingMenu,
  navBarLeadingMenuItem,
} from '@/components/nav-bar-leading-menu';
import { useLibrarySavedPresent } from '@/components/library/library-saved-view';
import { useLibrarySeriesPresent } from '@/components/library/library-series-view';
import { useCollectedView } from '@/data/collected-view';
import {
  ITEM_KIND_LABELS,
  type ItemKind,
  libraryViews,
  type SavedKind,
  setSelectedCollection,
  setSelectedItemKind,
} from '@/data/selected-collection';
import type { Collection } from '@/data/types';
import { useLibraryGrouping, useLibrarySort } from '@/hooks/use-library-sort';
import { initialSymbol } from '@/lib/initial-symbol';
import { useRouter } from '@/lib/nav';

type CollectionMenuProps = {
  collection: string | null;
  collections: Collection[];
  kind: ItemKind;
  kinds: ItemKind[];
  railNav: boolean;
};

/**
 * The Library's menu button, as Browse's bridge button: the view's mark — a collection's
 * initial, or All's asterisk — in an SF circle in the bar's glass capsule (kept, as Browse's is,
 * for the morph into the series page's back button), opening WHAT THE TAB SHOWS, the two axes
 * Browse's menu holds as Page and Bridge: the views as
 * checkmarked rows with "Manage collections…" after them, then the kind (Series / Chapters /
 * Pages) as a second section while the view holds more than one. The kind sat in the trailing
 * `⋯` with the filter and sort first, and could not be found there: it is not an arrangement of
 * the listing but a different listing, so it belongs with the collection, and the title names
 * both. A collection has no art of its own, so the mark is the symbol rather than a rendered
 * tile. While the sidebar rail lists the collections the view rows stay out, as the custom bar's
 * selector does, and the button remains only for the kind — gone with it (null) when there is
 * one. The button and its menu are `NavBarLeadingMenu`, as Browse's are, so a pick changes them
 * in place.
 */
function useLibraryCollectionMenu({ collection, collections, kind, kinds, railNav }: CollectionMenuProps) {
  const router = useRouter();
  const views = libraryViews(collections);
  const current = views.find((v) => v.id === collection) ?? views[0]!;
  const kindRows = kinds.length > 1;
  if (railNav && !kindRows) return null;
  const sections: LeadingMenuSection[] = [];
  if (!railNav) {
    sections.push({
      title: 'Collection',
      rows: [
        ...views.map((v) => ({
          id: v.testKey,
          title: v.name,
          symbol: v.id === null ? ('asterisk' as const) : initialSymbol(v.name),
          on: v.id === collection,
          onPress: () => setSelectedCollection(v.id),
        })),
        {
          id: 'manage',
          title: 'Manage collections…',
          symbol: 'folder',
          onPress: () => router.push('/manage-collections'),
        },
      ],
    });
  }
  if (kindRows) {
    sections.push({
      title: 'Show',
      rows: kinds.map((option) => ({
        id: option,
        title: ITEM_KIND_LABELS[option],
        symbol: KIND_SYMBOLS[option],
        on: option === kind,
        onPress: () => setSelectedItemKind(option),
      })),
    });
  }
  const menu: LeadingMenuProps = {
    symbol: collection === null ? 'asterisk.circle.fill' : initialSymbol(current.name, 'circle'),
    label: `${current.name}, collection`,
    sections,
  };
  return menu;
}

const KIND_SYMBOLS: Record<ItemKind, 'books.vertical' | 'book' | 'photo'> = {
  series: 'books.vertical',
  chapter: 'book',
  page: 'photo',
};

/**
 * The Library's items in the iOS navigation bar, ONE trailing toolbar (a second trailing toolbar
 * replaces the first's items outright): the collection menu in its own capsule, then the
 * arranging controls as one `⋯` menu at the edge beside the search (the bar lists its trailing
 * items from the edge in, so the menu comes FIRST here), as
 * Files and Notes keep theirs: Filter and Sort as submenus (each keeping its own icon), the same
 * axes the custom bar keeps beside its title.
 *
 * Not the bottom toolbar, where iOS 26 puts that tier (Mail, Notes): `Stack.Toolbar
 * placement="bottom"` is the UINavigationController's real toolbar, and under the system tab
 * bar it is laid out BENEATH the floating bar — the items were there, hidden under the tabs.
 * The only sanctioned slot down there is `NativeTabs.BottomAccessory`, which is app-wide, not
 * the tab's.
 *
 * One component per kind rather than one with a branch inside, because every item has to be a
 * direct child of Stack.Toolbar (the native bar reads the element tree, so a wrapper component is
 * invisible to it) and each kind's menus read a different listing for their source list.
 */
export function LibraryNativeToolbar(props: CollectionMenuProps) {
  const menu = useLibraryCollectionMenu(props);
  return props.kind === 'series' ? (
    <SeriesToolbar collection={props.collection} menu={menu} />
  ) : (
    <SavedToolbar collection={props.collection} kind={props.kind} menu={menu} />
  );
}

function SeriesToolbar({ collection, menu }: { collection: string | null; menu: LeadingMenuProps | null }) {
  const [sort, setSort] = useLibrarySort(collection);
  const [grouping, setGrouping] = useLibraryGrouping();
  const present = useLibrarySeriesPresent(collection, sort);
  const filterState = useLibraryFilterState(present);
  return (
    <>
      <Stack.Toolbar placement="right">
        {/* The fixed space splits the shared glass: the menu in its own capsule (browse-native-toolbar). */}
        {menu ? navBarLeadingMenuItem(menu) : null}
        {menu ? <Stack.Toolbar.Spacer width={0} /> : null}
        <Stack.Toolbar.Menu {...arrangeMenu(libraryFilterNarrowing({ withShow: true, ...filterState }))}>
          {libraryFilterMenu({ withShow: true, ...filterState })}
          {librarySortMenu({ value: sort, onChange: setSort, grouping, onGroupingChange: setGrouping })}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {menu ? <NavBarLeadingMenu {...menu} /> : null}
    </>
  );
}

function SavedToolbar({
  collection,
  kind,
  menu,
}: {
  collection: string | null;
  kind: SavedKind;
  menu: LeadingMenuProps | null;
}) {
  const [view, setView] = useCollectedView(collection, kind);
  const present = useLibrarySavedPresent(collection, kind, view);
  const filterState = useLibraryFilterState(present);
  return (
    <>
      <Stack.Toolbar placement="right">
        {menu ? navBarLeadingMenuItem(menu) : null}
        {menu ? <Stack.Toolbar.Spacer width={0} /> : null}
        <Stack.Toolbar.Menu {...arrangeMenu(libraryFilterNarrowing({ withShow: false, ...filterState }))}>
          {libraryFilterMenu({ withShow: false, ...filterState })}
          {collectedSortMenu({ value: view, onChange: setView })}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {menu ? <NavBarLeadingMenu {...menu} /> : null}
    </>
  );
}

/** The menu's own button: filled while a filter narrows the listing, as the custom filter
 *  button is, since the filter's icon is inside the menu now. */
function arrangeMenu(narrowing: boolean) {
  return {
    icon: narrowing ? ('ellipsis.circle.fill' as const) : ('ellipsis.circle' as const),
    accessibilityLabel: narrowing ? 'Arrange, filtered' : 'Arrange',
  };
}
