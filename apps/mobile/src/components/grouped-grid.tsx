import type { LegendListRef } from '@legendapp/list/react-native';
import { useCallback, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { RecyclerList } from '@/components/recycler-list';
import { StickySectionHeader, type StickySection } from '@/components/sticky-section-header';
import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import type { GroupedRow } from '@/data/grouped-rows';

/** A section's heading row — rendered BOTH inline by the list and, identically, by the pinned
 *  sticky. `hidden` drops its content (not its space) on the inline one while the pinned copy is
 *  standing in for it, so one heading is never drawn twice. */
function SectionHeader({ label, count, hidden }: { label: string; count?: number; hidden?: boolean }) {
  return (
    <View style={[styles.header, hidden && styles.hidden]}>
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
 * `StickySectionHeader` — the heading row itself, held at the top bar's bottom edge on a blurred
 * material. Both grouped surfaces (the collected grid and the library grid) render through this.
 * Callers own what an items row LOOKS like (`renderRow`) and how tall it is (`rowHeight`);
 * headings are the shared `SectionHeader`, rendered by the list and the sticky alike. Fixed row
 * heights are what keep a sectioned list from re-measuring as it scrolls — and what make the
 * sticky's offsets exact.
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
  /** An items row's fixed height (headings are always `RowHeight`). */
  rowHeight: number;
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  header?: ReactElement | null;
  paddingTop: number;
  paddingBottom: number;
  /** Symmetric horizontal content padding — also applied to the pinned copy so it aligns. */
  sidePad: number;
  /** Screen-relative y where the heading pins — the top bar's bottom edge. Omit to disable the
   *  sticky (headings then simply scroll away inline). */
  stickyHeaderTop?: number;
  /** Feeds the tab bar's UI-thread slide — and the sticky's arithmetic. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** One items row's content. The caller lays the row out (widths, gaps, short-row alignment). */
  renderRow: (items: T[]) => ReactElement;
}) {
  // Each section heading's CONTENT offset (the y its row starts at, in scroll coordinates —
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
      // The ROW's top: the pinned copy IS this row, so pinning it there superimposes the two
      // exactly at the hand-off.
      if (row.type === 'header') out.push({ key: row.key, label: row.label, count: row.count, top: y });
      y += row.type === 'header' ? RowHeight : rowHeight;
    }
    return out;
  }, [rows, header, stickyHeaderTop, paddingTop, rowHeight]);

  // The heading the pinned copy is currently standing in for — that row renders its space but not
  // its content, so one heading is never drawn twice.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const onActiveChange = useCallback((key: string | null) => setPinnedKey(key), []);

  return (
    <View style={styles.fill}>
      <RecyclerList
        data={rows}
        scopeKey={scopeKey}
        listRef={listRef}
        keyExtractor={(row) => row.key}
        // Distinct pools per row type, so a heading never recycles into an items row (and vice versa).
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
          row.type === 'header' ? (
            <SectionHeader label={row.label} count={row.count} hidden={row.key === pinnedKey} />
          ) : (
            renderRow(row.items)
          )
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
          onActiveChange={onActiveChange}
          // The SAME component the list renders inline — see StickySectionHeader.
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
  // Space preserved, content dropped, while the pinned copy stands in — see SectionHeader.
  hidden: {
    opacity: 0,
  },
});
