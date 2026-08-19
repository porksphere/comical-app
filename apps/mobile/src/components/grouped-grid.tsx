import type { LegendListRef } from '@legendapp/list/react-native';
import { useMemo, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { RecyclerList } from '@/components/recycler-list';
import { StickySectionHeader, type StickySection } from '@/components/sticky-section-header';
import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import type { GroupedRow } from '@/data/grouped-rows';

/** One section header's content — rendered twice: as the inline row inside the list, and as the
 *  pinned STICKY copy. One component so the two can never drift apart (the sticky illusion depends
 *  on them being pixel-identical at the moment of hand-off). */
function SectionHeader({ label, count }: { label: string; count?: number }) {
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
 * THE grouped grid: pre-computed header/items rows over `RecyclerList`, plus the pinned
 * `StickySectionHeader`. Both grouped surfaces — the collected grid and the library grid — render
 * through this. Callers own what an items row LOOKS like (`renderRow`) and how tall it is
 * (`rowHeight`); headers are the shared `SectionHeader`. Fixed row heights are what keep a
 * sectioned list from re-measuring as it scrolls — and what make the sticky's offsets exact.
 */
export function GroupedGrid<T>({
  rows,
  rowHeight,
  scopeKey,
  listRef,
  header,
  paddingTop,
  paddingBottom,
  sidePad,
  stickyHeaderTop,
  sharedValues,
  onScroll,
  renderRow,
}: {
  rows: GroupedRow<T>[];
  /** An items row's fixed height (headers are always `RowHeight`). */
  rowHeight: number;
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  header?: ReactElement | null;
  paddingTop: number;
  paddingBottom: number;
  /** Symmetric horizontal content padding — also applied to the sticky copy so it aligns. */
  sidePad: number;
  /** Screen-relative y where the sticky section header pins — the top bar's bottom edge. Omit to
   *  disable the sticky (headers then simply scroll away inline). */
  stickyHeaderTop?: number;
  /** Feeds the tab bar's UI-thread slide — and the sticky header's arithmetic. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** One items row's content. The caller lays the row out (widths, gaps, short-row alignment). */
  renderRow: (items: T[]) => ReactElement;
}) {
  // Each section header's CONTENT offset (the y its row starts at, in scroll coordinates —
  // contentOffset 0 is the top of the padding). Fixed row heights make this exact, no measuring.
  const sections = useMemo<StickySection[]>(() => {
    if (stickyHeaderTop === undefined) return [];
    // A list header (the empty/error block) sits above the rows and shifts every offset by its
    // unmeasured height. It only renders when the list is empty or broken, so skipping the sticky
    // there costs nothing — but the guard keeps the arithmetic honest if that ever changes.
    if (header) return [];
    const out: StickySection[] = [];
    let y = paddingTop;
    for (const row of rows) {
      if (row.type === 'header') out.push({ label: row.label, count: row.count, top: y });
      y += row.type === 'header' ? RowHeight : rowHeight;
    }
    return out;
  }, [rows, header, stickyHeaderTop, paddingTop, rowHeight]);

  return (
    <View style={styles.fill}>
      <RecyclerList
        data={rows}
        scopeKey={scopeKey}
        listRef={listRef}
        keyExtractor={(row) => row.key}
        // Distinct pools per row type, so a header never recycles into an items row (and vice versa).
        getItemType={(row) => row.type}
        getFixedItemSize={(row) => (row.type === 'header' ? RowHeight : rowHeight)}
        estimatedItemSize={rowHeight}
        header={header}
        paddingTop={paddingTop}
        paddingBottom={paddingBottom}
        sidePad={sidePad}
        sharedValues={sharedValues}
        onScroll={onScroll}
        renderItem={({ item: row }) =>
          row.type === 'header' ? <SectionHeader label={row.label} count={row.count} /> : renderRow(row.items)
        }
      />
      {stickyHeaderTop !== undefined && sharedValues && (
        <StickySectionHeader
          sections={sections}
          stickyTop={stickyHeaderTop}
          height={RowHeight}
          sidePad={sidePad}
          resetKey={scopeKey}
          scrollOffset={sharedValues.scrollOffset}
          renderHeader={(s) => <SectionHeader label={s.label} count={s.count} />}
        />
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
});
