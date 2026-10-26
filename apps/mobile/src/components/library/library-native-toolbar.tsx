import { Stack } from 'expo-router';

import { collectedSortMenu } from '@/components/collections/collected-sort-button';
import { libraryFilterMenu, useLibraryFilterState } from '@/components/library-filter-button';
import { librarySortMenu } from '@/components/library-sort-button';
import { useLibrarySavedPresent } from '@/components/library/library-saved-view';
import { useLibrarySeriesPresent } from '@/components/library/library-series-view';
import { useCollectedView } from '@/data/collected-view';
import { ITEM_KIND_LABELS, type ItemKind, type SavedKind, setSelectedItemKind } from '@/data/selected-collection';
import { useLibraryGrouping, useLibrarySort } from '@/hooks/use-library-sort';

/**
 * The Library's arranging controls as the iOS bottom toolbar: the kind picker leading, the filter
 * and sort menus trailing — the same axes the custom bar keeps beside its title, moved down so the
 * navigation bar holds only the collection and the search. iOS 26 puts secondary controls there
 * (Mail, Notes), and in the sidebar layout the bottom toolbar stays with the content column.
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
    <Stack.Toolbar placement="bottom">
      {kindMenu(kind, kinds)}
      <Stack.Toolbar.Spacer />
      {libraryFilterMenu({ withShow: true, ...filterState })}
      {librarySortMenu({ value: sort, onChange: setSort, grouping, onGroupingChange: setGrouping })}
    </Stack.Toolbar>
  );
}

function SavedToolbar({ collection, kind, kinds }: { collection: string | null; kind: SavedKind; kinds: ItemKind[] }) {
  const [view, setView] = useCollectedView(collection, kind);
  const present = useLibrarySavedPresent(collection, kind, view);
  const filterState = useLibraryFilterState(present);
  return (
    <Stack.Toolbar placement="bottom">
      {kindMenu(kind, kinds)}
      <Stack.Toolbar.Spacer />
      {libraryFilterMenu({ withShow: false, ...filterState })}
      {collectedSortMenu({ value: view, onChange: setView })}
    </Stack.Toolbar>
  );
}

/** Series / chapters / pages — hidden while the view holds only one kind, as the custom selector is. */
function kindMenu(kind: ItemKind, kinds: ItemKind[]) {
  return (
    <Stack.Toolbar.Menu hidden={kinds.length < 2} accessibilityLabel="Kind">
      <Stack.Toolbar.Label>{ITEM_KIND_LABELS[kind]}</Stack.Toolbar.Label>
      {kinds.map((option) => (
        <Stack.Toolbar.MenuAction key={option} isOn={option === kind} onPress={() => setSelectedItemKind(option)}>
          {ITEM_KIND_LABELS[option]}
        </Stack.Toolbar.MenuAction>
      ))}
    </Stack.Toolbar.Menu>
  );
}
