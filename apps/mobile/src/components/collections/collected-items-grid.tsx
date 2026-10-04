import type { LegendListRef } from '@legendapp/list/react-native';
import { useMemo, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { CollectedItemTile } from '@/components/collections/collected-item-tile';
import { GroupedGrid } from '@/components/grouped-grid';
import { estimatedCardHeight } from '@/components/series-card';
import type { ApiCollectionItem } from '@/data/api';
import { buildCollectedRows, type CollectedRow } from '@/data/collected-rows';
import type { CollectedGrouping } from '@/data/collected-view';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useCollectedPageUris } from '@/hooks/use-collected-page-uris';
import { GRID_ROW_GAP, useGridLayout } from '@/hooks/use-grid-layout';

/**
 * The grid of collected items — a `GroupedGrid` (which owns the row list and the sticky section
 * header) skinned with the collected tile.
 *
 * All three item types share the one tile (`CollectedItemTile`); the tile's type-icon badge is
 * what distinguishes them, so a mixed collection reads as one surface rather than three interleaved
 * layouts.
 *
 * A row is as tall as a row of the Library's series cards, caption included, whatever shape its
 * covers take and its titles run to: the list is told one height for every row.
 */
export function CollectedItemsGrid({
  items,
  grouping,
  scopeKey,
  listRef,
  header,
  paddingTop,
  paddingBottom,
  stickyHeaderTop,
  stickyPinned,
  sharedValues,
  onScroll,
  onOpen,
  onWarm,
}: {
  items: ApiCollectionItem[];
  /** Client-side sectioning applied over the server's order — see `buildCollectedRows`. */
  grouping: CollectedGrouping;
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  header?: ReactElement | null;
  paddingTop: number;
  paddingBottom: number;
  /** Screen-relative y where the sticky section header pins — see `GroupedGrid`. */
  stickyHeaderTop?: number;
  /** Written by the sticky while a heading is pinned, so the screen can drop its bar's own rule on
   *  the same frame. */
  stickyPinned?: SharedValue<number>;
  /** Feeds the tab bar's UI-thread slide, exactly as `SeriesGrid` does — and the sticky header's
   *  push-out ride. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Tapping any item — the caller routes by `type` (a page opens the reader at that page, a
   *  chapter at its first page, a series its detail screen). */
  onOpen: (item: ApiCollectionItem) => void;
  /** Press-in warm for the destination `onOpen` will push — see CollectedItemTile. */
  onWarm?: (item: ApiCollectionItem) => void;
}) {
  const { numColumns, sidePad, cardWidth, columnGap } = useGridLayout();
  const { nameOf, directOf } = useBridgeMap();
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

  return (
    <GroupedGrid
      rows={rows}
      rowHeight={estimatedCardHeight(cardWidth, true) + GRID_ROW_GAP}
      scopeKey={scopeKey}
      listRef={listRef}
      header={header}
      paddingTop={paddingTop}
      paddingBottom={paddingBottom}
      sidePad={sidePad}
      stickyHeaderTop={grouping === 'none' ? undefined : stickyHeaderTop}
      stickyPinned={stickyPinned}
      sharedValues={sharedValues}
      onScroll={onScroll}
      renderRow={(rowItems) => (
        <View style={[styles.row, { gap: columnGap }]}>
          {rowItems.map((item) => (
            <CollectedItemTile
              key={item.id}
              item={item}
              uri={uris.get(item.id)}
              // A series says where it comes from, as its Library card does; a chapter or a page
              // says which chapter, the page's number being on its badge already.
              sub={item.type === 'series' ? nameOf(item.bridgeId) : item.chapterName}
              bridge={nameOf(item.bridgeId)}
              direct={directOf(item.bridgeId)}
              width={cardWidth}
              onPress={() => onOpen(item)}
              onWarm={onWarm && (() => onWarm(item))}
            />
          ))}
          {/* Keeps a short final row left-aligned instead of stretching its tiles. */}
          {rowItems.length < numColumns &&
            Array.from({ length: numColumns - rowItems.length }).map((_, i) => (
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
    paddingBottom: GRID_ROW_GAP,
  },
});
