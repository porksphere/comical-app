import { Stack } from 'expo-router';

import { collectedSortMenu } from '@/components/collections/collected-sort-button';
import { libraryFilterMenu, libraryFilterNarrowing, useLibraryFilterState } from '@/components/library-filter-button';
import { librarySortMenu } from '@/components/library-sort-button';
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

/**
 * The Library's leading bar button, as Browse's bridge button: the view's mark — a collection's
 * initial, or All's asterisk — in an SF circle with no glass behind it (`hidesSharedBackground`),
 * opening the views as checkmarked rows with "Manage collections…" after them. A collection has
 * no art of its own, so the mark is the symbol rather than a rendered tile. Absent while the
 * sidebar rail lists the collections, as the custom bar's selector is.
 */
export function LibraryCollectionMenu({ collection, collections }: { collection: string | null; collections: Collection[] }) {
  const router = useRouter();
  const views = libraryViews(collections);
  const current = views.find((v) => v.id === collection) ?? views[0]!;
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Menu
        icon={collection === null ? 'asterisk.circle.fill' : initialSymbol(current.name, 'circle')}
        hidesSharedBackground
        accessibilityLabel={`${current.name}, collection`}>
        <Stack.Toolbar.Menu inline title="Collection">
          {views.map((v) => (
            <Stack.Toolbar.MenuAction
              key={v.testKey}
              isOn={v.id === collection}
              icon={v.id === null ? 'asterisk' : initialSymbol(v.name)}
              onPress={() => setSelectedCollection(v.id)}>
              {v.name}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.MenuAction icon="folder" onPress={() => router.push('/manage-collections')}>
          Manage collections…
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/**
 * The Library's arranging controls as ONE trailing menu in the iOS navigation bar — the `⋯`
 * beside the search button, as Files and Notes keep theirs: the kind as an inline section at
 * the top, then Filter and Sort as submenus (each keeping its own icon), the same axes the
 * custom bar keeps beside its title.
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
export function LibraryNativeToolbar({
  collection,
  kind,
  kinds,
}: {
  collection: string | null;
  kind: ItemKind;
  kinds: ItemKind[];
}) {
  return kind === 'series' ? (
    <SeriesToolbar collection={collection} kind={kind} kinds={kinds} />
  ) : (
    <SavedToolbar collection={collection} kind={kind} kinds={kinds} />
  );
}

function SeriesToolbar({ collection, kind, kinds }: { collection: string | null; kind: ItemKind; kinds: ItemKind[] }) {
  const [sort, setSort] = useLibrarySort(collection);
  const [grouping, setGrouping] = useLibraryGrouping();
  const present = useLibrarySeriesPresent(collection, sort);
  const filterState = useLibraryFilterState(present);
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu {...arrangeMenu(libraryFilterNarrowing({ withShow: true, ...filterState }))}>
        {kindMenu(kind, kinds)}
        {libraryFilterMenu({ withShow: true, ...filterState })}
        {librarySortMenu({ value: sort, onChange: setSort, grouping, onGroupingChange: setGrouping })}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

function SavedToolbar({ collection, kind, kinds }: { collection: string | null; kind: SavedKind; kinds: ItemKind[] }) {
  const [view, setView] = useCollectedView(collection, kind);
  const present = useLibrarySavedPresent(collection, kind, view);
  const filterState = useLibraryFilterState(present);
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu {...arrangeMenu(libraryFilterNarrowing({ withShow: false, ...filterState }))}>
        {kindMenu(kind, kinds)}
        {libraryFilterMenu({ withShow: false, ...filterState })}
        {collectedSortMenu({ value: view, onChange: setView })}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
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

/** Series / chapters / pages, an inline section at the top of the menu — absent while the view
 *  holds only one kind, as the custom selector is. */
function kindMenu(kind: ItemKind, kinds: ItemKind[]) {
  if (kinds.length < 2) return null;
  return (
    <Stack.Toolbar.Menu inline title="Kind">
      {kinds.map((option) => (
        <Stack.Toolbar.MenuAction key={option} isOn={option === kind} onPress={() => setSelectedItemKind(option)}>
          {ITEM_KIND_LABELS[option]}
        </Stack.Toolbar.MenuAction>
      ))}
    </Stack.Toolbar.Menu>
  );
}
