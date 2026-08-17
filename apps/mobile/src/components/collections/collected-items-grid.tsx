import type { LegendListRef } from '@legendapp/list/react-native';
import type { ReactElement, RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { CollectedPageTile } from '@/components/collections/collected-page-tile';
import { RecyclerList } from '@/components/recycler-list';
import { Spacing } from '@/constants/theme';
import type { ApiCollectionItem, ApiCollectionPageItem } from '@/data/api';
import { useCollectedPageUris } from '@/hooks/use-collected-page-uris';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';

/** A page tile is a fixed 2:3 slot, like the series-page thumbnail grid. Fixed rather than
 *  aspect-driven so LegendList never re-measures mid-scroll — the same discipline `series-grid.tsx`
 *  uses, and what `todo.md` separately asks for on page thumbs. */
const TILE_ASPECT = 3 / 2;

type Row = { key: string; items: ApiCollectionPageItem[] };

/**
 * The grid of saved pages, rendered as pre-computed ROWS rather than a columned list.
 *
 * Rows are built here instead of leaning on `numColumns` because grouping (by series, by date) will
 * interleave header rows between them — a list of mixed row types is the shape that supports that,
 * and building it now means Phase 3 adds a header variant rather than restructuring.
 *
 * Only page items render today. A collection can also hold series and chapter items, and browsing
 * one returns the mixed union — that lands in Phase 4, which is why the row type is `items` rather
 * than a page-specific name.
 */
export function CollectedItemsGrid({
  items,
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
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  header?: ReactElement | null;
  paddingTop: number;
  paddingBottom: number;
  /** Feeds the tab bar's UI-thread slide, exactly as `SeriesGrid` does. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onOpen: (item: ApiCollectionPageItem) => void;
}) {
  const { numColumns, sidePad, cardWidth } = useGridLayout();
  // One request per CHAPTER, not per tile — see the hook. Read during render as a lookup table;
  // never a memo dependency (it is a fresh Map each render by design).
  const uris = useCollectedPageUris(items);

  const pages = items.filter((i): i is ApiCollectionPageItem => i.type === 'page');
  const rows: Row[] = [];
  for (let i = 0; i < pages.length; i += numColumns) {
    const slice = pages.slice(i, i + numColumns);
    rows.push({ key: slice.map((p) => p.id).join('|'), items: slice });
  }

  const tileHeight = cardWidth * TILE_ASPECT;
  // Row height is constant, so the list can size every row without measuring one.
  const rowHeight = tileHeight + Spacing.three;

  return (
    <RecyclerList
      data={rows}
      scopeKey={scopeKey}
      listRef={listRef}
      keyExtractor={(row) => row.key}
      getFixedItemSize={() => rowHeight}
      estimatedItemSize={rowHeight}
      header={header}
      paddingTop={paddingTop}
      paddingBottom={paddingBottom}
      sidePad={sidePad}
      sharedValues={sharedValues}
      onScroll={onScroll}
      renderItem={({ item: row }) => (
        <View style={styles.row}>
          {row.items.map((item) => (
            <CollectedPageTile
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
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
    paddingBottom: Spacing.three,
  },
});
