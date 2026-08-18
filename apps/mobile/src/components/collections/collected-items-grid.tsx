import type { LegendListRef } from '@legendapp/list/react-native';
import { useMemo, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { CollectedItemTile } from '@/components/collections/collected-item-tile';
import { RecyclerList } from '@/components/recycler-list';
import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import type { ApiCollectionItem } from '@/data/api';
import { buildCollectedRows, type CollectedRow } from '@/data/collected-rows';
import type { CollectedGrouping } from '@/data/collected-view';
import { useCollectedPageUris } from '@/hooks/use-collected-page-uris';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';

/** A page tile is a fixed 2:3 slot, like the series-page thumbnail grid. Fixed rather than
 *  aspect-driven so LegendList never re-measures mid-scroll — the same discipline `series-grid.tsx`
 *  uses, and what `todo.md` separately asks for on page thumbs. */
const TILE_ASPECT = 3 / 2;

/**
 * The grid of collected items, rendered as pre-computed ROWS rather than a columned list — rows are
 * what lets grouping interleave section headers, and what gives every row a knowable fixed height.
 *
 * All three item types share the one 2:3 tile (`CollectedItemTile`); the tile's type-icon badge is
 * what distinguishes them, so a mixed collection reads as one grid rather than three interleaved
 * layouts.
 */
export function CollectedItemsGrid({
  items,
  grouping,
  scopeKey,
  listRef,
  header,
  paddingTop,
  paddingBottom,
  sharedValues,
  onScroll,
  onOpen,
}: {
  items: ApiCollectionItem[];
  /** Client-side sectioning applied over the server's order — see `buildCollectedRows`. */
  grouping: CollectedGrouping;
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  header?: ReactElement | null;
  paddingTop: number;
  paddingBottom: number;
  /** Feeds the tab bar's UI-thread slide, exactly as `SeriesGrid` does. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Tapping any item — the caller routes by `type` (a page opens the reader at that page, a
   *  chapter at its first page, a series its detail screen). */
  onOpen: (item: ApiCollectionItem) => void;
}) {
  const { numColumns, sidePad, cardWidth } = useGridLayout();
  // One request per CHAPTER, not per tile — see the hook. Read during render as a lookup table;
  // never a memo dependency (it is a fresh Map each render by design).
  const uris = useCollectedPageUris(items);

  // Memoized on the data, the column count and the grouping — NOT on `uris`, which is a fresh Map
  // every render by design (see the hook). Rows carry items; tiles look their URL up at render
  // time, so a URL arriving repaints tiles without rebuilding the list's data array.
  const rows = useMemo<CollectedRow[]>(
    () => buildCollectedRows(items, numColumns, grouping),
    [items, numColumns, grouping],
  );

  const tileHeight = cardWidth * TILE_ASPECT;
  // Both row heights are constant, so the list sizes every row without measuring one — which is
  // what keeps a sectioned list from re-measuring as it scrolls.
  const tileRowHeight = tileHeight + Spacing.three;
  const headerRowHeight = RowHeight;

  return (
    <RecyclerList
      data={rows}
      scopeKey={scopeKey}
      listRef={listRef}
      keyExtractor={(row) => row.key}
      // Distinct pools per row type, so a header never recycles into a tile row (and vice versa).
      getItemType={(row) => row.type}
      getFixedItemSize={(row) => (row.type === 'header' ? headerRowHeight : tileRowHeight)}
      estimatedItemSize={tileRowHeight}
      header={header}
      paddingTop={paddingTop}
      paddingBottom={paddingBottom}
      sidePad={sidePad}
      sharedValues={sharedValues}
      onScroll={onScroll}
      renderItem={({ item: row }) => {
        if (row.type === 'header') {
          return (
            <View style={styles.header}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.headerLabel}>
                {row.label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {row.count}
              </ThemedText>
            </View>
          );
        }
        return (
          <View style={styles.row}>
            {row.items.map((item) => (
              <CollectedItemTile
                key={item.id}
                item={item}
                uri={uris.get(item.id)}
                width={cardWidth}
                height={tileHeight}
                onPress={() => onOpen(item)}
              />
            ))}
            {/* Keeps a short final row left-aligned instead of stretching its tiles. */}
            {row.items.length < numColumns &&
              Array.from({ length: numColumns - row.items.length }).map((_, i) => (
                <View key={`pad-${i}`} style={{ width: cardWidth }} />
              ))}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: RowHeight,
    gap: Spacing.two,
  },
  headerLabel: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
    paddingBottom: Spacing.three,
  },
});
