import type { LegendListRef } from '@legendapp/list/react-native';
import { useMemo, useState, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { CollectedItemTile } from '@/components/collections/collected-item-tile';
import { RecyclerList } from '@/components/recycler-list';
import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import type { ApiCollectionItem } from '@/data/api';
import { buildCollectedRows, type CollectedRow } from '@/data/collected-rows';
import type { CollectedGrouping } from '@/data/collected-view';
import { useCollectedPageUris } from '@/hooks/use-collected-page-uris';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';
import { useTheme } from '@/hooks/use-theme';

/** A page tile is a fixed 2:3 slot, like the series-page thumbnail grid. Fixed rather than
 *  aspect-driven so LegendList never re-measures mid-scroll — the same discipline `series-grid.tsx`
 *  uses, and what `todo.md` separately asks for on page thumbs. */
const TILE_ASPECT = 3 / 2;

/** One section header's content — rendered twice: as the inline row inside the list, and as the
 *  pinned STICKY copy. One component so the two can never drift apart (the sticky illusion depends
 *  on them being pixel-identical at the moment of hand-off). */
function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <View style={styles.header}>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.headerLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {count}
      </ThemedText>
    </View>
  );
}

/**
 * The grid of collected items, rendered as pre-computed ROWS rather than a columned list — rows are
 * what lets grouping interleave section headers, and what gives every row a knowable fixed height.
 *
 * All three item types share the one 2:3 tile (`CollectedItemTile`); the tile's type-icon badge is
 * what distinguishes them, so a mixed collection reads as one surface rather than three interleaved
 * layouts.
 *
 * GROUPED mode gets a STICKY section header, built as an overlay rather than through the list:
 * list-level sticky rows pin to the scroll viewport's top edge, which on this screen is UNDER the
 * translucent top bar (content deliberately scrolls behind it) — exactly where a header is useless.
 * Every row's height is fixed and known, so the current section is pure arithmetic on the scroll
 * offset: a JS handler swaps WHICH section shows (state changes only at boundaries), and the
 * classic push-out ride is an animated style on the UI-thread scroll offset the list already
 * publishes. The overlay pins just below the bar (`stickyHeaderTop`), clipped so the pushed-out
 * header can't bleed up behind it.
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
  /** Screen-relative y where the sticky section header pins — the top bar's bottom edge. Omit to
   *  disable the sticky (grouped headers then simply scroll away inline). */
  stickyHeaderTop?: number;
  /** Feeds the tab bar's UI-thread slide, exactly as `SeriesGrid` does — and the sticky header's
   *  push-out ride. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Tapping any item — the caller routes by `type` (a page opens the reader at that page, a
   *  chapter at its first page, a series its detail screen). */
  onOpen: (item: ApiCollectionItem) => void;
}) {
  const theme = useTheme();
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

  // ── The sticky header's arithmetic ─────────────────────────────────────────
  // Each section header's CONTENT offset (the y its row starts at, in scroll coordinates —
  // contentOffset 0 is the top of the padding). Fixed row heights make this exact, no measuring.
  const sections = useMemo(() => {
    if (grouping === 'none' || stickyHeaderTop === undefined) return [];
    const out: { label: string; count: number; top: number }[] = [];
    let y = paddingTop;
    for (const row of rows) {
      if (row.type === 'header') out.push({ label: row.label, count: row.count, top: y });
      y += row.type === 'header' ? headerRowHeight : tileRowHeight;
    }
    return out;
  }, [rows, grouping, stickyHeaderTop, paddingTop, headerRowHeight, tileRowHeight]);

  // WHICH section is pinned — JS state, changed only at section boundaries (the per-frame ride is
  // the animated style below). -1 = none: at rest the first inline header is still below the bar,
  // and duplicating it there would read as two lists again.
  const [activeSection, setActiveSection] = useState(-1);
  // A scope change is a scroll-to-top moment (the list itself remounts on it) — the pinned section
  // must reset with it. Adjust-on-render, the house pattern.
  const [seenScope, setSeenScope] = useState(scopeKey);
  if (seenScope !== scopeKey) {
    setSeenScope(scopeKey);
    setActiveSection(-1);
  }
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScroll?.(e);
    if (sections.length === 0 || stickyHeaderTop === undefined) return;
    // The pin line, in content coordinates: the point of the content currently under the bar's
    // bottom edge. The pinned section is the last one whose header has reached it.
    const line = e.nativeEvent.contentOffset.y + stickyHeaderTop;
    let idx = -1;
    for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
    setActiveSection(idx);
  };

  // The push-out: as the NEXT section's inline header approaches the pin line, it shoves the
  // pinned one up and out — computed per frame on the UI thread from the same scroll offset that
  // slides the tab bar, so it tracks the finger exactly (the JS state above only swaps the text).
  const scrollOffsetSV = sharedValues?.scrollOffset ?? null;
  const stickyPushStyle = useAnimatedStyle(() => {
    if (!scrollOffsetSV || sections.length === 0 || stickyHeaderTop === undefined) {
      return { transform: [{ translateY: 0 }] };
    }
    const line = scrollOffsetSV.value + stickyHeaderTop;
    let idx = -1;
    for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
    const next = sections[idx + 1];
    const push = next ? Math.min(0, next.top - line - RowHeight) : 0;
    return { transform: [{ translateY: Math.max(push, -RowHeight) }] };
  }, [scrollOffsetSV, sections, stickyHeaderTop]);

  const sticky = activeSection >= 0 ? sections[activeSection] : undefined;

  return (
    <View style={styles.fill}>
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
        onScroll={handleScroll}
        renderItem={({ item: row }) => {
          if (row.type === 'header') {
            return <SectionHeader label={row.label} count={row.count} />;
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
      {/* The pinned header, in a CLIP at the bar's bottom edge: the push-out translates the
          content up, and without the clip it would slide visibly up behind the (translucent)
          top bar instead of disappearing under its edge. Non-interactive — the real header row
          is still in the list. */}
      {stickyHeaderTop !== undefined && sticky && (
        <View pointerEvents="none" style={[styles.stickyClip, { top: stickyHeaderTop }]}>
          <Animated.View
            style={[
              styles.stickyContent,
              { backgroundColor: theme.background, paddingHorizontal: sidePad },
              stickyPushStyle,
            ]}>
            <SectionHeader label={sticky.label} count={sticky.count} />
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
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
  stickyClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: RowHeight,
    overflow: 'hidden',
  },
  stickyContent: {
    height: RowHeight,
  },
});
