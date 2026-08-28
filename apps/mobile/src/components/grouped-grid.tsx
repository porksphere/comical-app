import type { LegendListRef } from '@legendapp/list/react-native';
import { useCallback, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { type AnimatedRef, type SharedValue } from 'react-native-reanimated';

import { RecyclerList } from '@/components/recycler-list';
import {
  StickySectionHeader,
  useInlineHeadingStyle,
  type InlineHeadingPin,
  type StickySection,
} from '@/components/sticky-section-header';
import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import type { GroupedRow } from '@/data/grouped-rows';

/** A section's heading row — rendered BOTH inline by the list and, identically, by the pinned
 *  sticky. `hidden` drops its content (not its space) on the inline one while the pinned copy is
 *  standing in for it, so one heading is never drawn twice. `useInlineHeadingStyle` owns the timing
 *  of that swap, in both directions. */
function SectionHeader({
  label,
  count,
  hidden,
  pin,
}: {
  label: string;
  count?: number;
  hidden?: boolean;
  /** Absent on the PINNED copy, which is the thing standing in and so is never the one hidden. */
  pin?: InlineHeadingPin;
}) {
  const hide = useInlineHeadingStyle(hidden ?? false, pin);
  return (
    <Animated.View style={[styles.header, hide]}>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.headerLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {count}
      </ThemedText>
    </Animated.View>
  );
}

/**
 * THE grouped grid: pre-computed header/items rows over `RecyclerList`, plus the pinned
 * `StickySectionHeader` — the heading row itself, held at the top bar's bottom edge on the page's
 * own background with a hairline under it. Both grouped surfaces (the collected grid and the library grid) render through this.
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
  scrollRef,
  header,
  paddingTop,
  paddingBottom,
  sidePad,
  stickyHeaderTop,
  stickyPinned,
  sharedValues,
  onScroll,
  renderRow,
}: {
  rows: GroupedRow<T>[];
  /** An items row's fixed height (headings are always `RowHeight`). */
  rowHeight: number;
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  /** Passed through to `RecyclerList` — see the doc there (the sliding bar's lockstep scroll). */
  scrollRef?: AnimatedRef<Animated.ScrollView>;
  header?: ReactElement | null;
  paddingTop: number;
  paddingBottom: number;
  /** Symmetric horizontal content padding — also applied to the pinned copy so it aligns. */
  sidePad: number;
  /** Screen-relative y where the heading pins — the top bar's bottom edge. Omit to disable the
   *  sticky (headings then simply scroll away inline). */
  stickyHeaderTop?: number;
  /** Written by the sticky: 1 while a heading is pinned. The screen drops its top bar's own rule
   *  off this, on the same frame — see StickySectionHeader's `pinnedValue`. */
  stickyPinned?: SharedValue<number>;
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
  // What each heading row needs to time its own swap with the band's — see `useInlineHeadingStyle`.
  // No `bandPadding`: the row centres its own text in `RowHeight`, so the band adds none either.
  const pin: InlineHeadingPin = useMemo(
    () => ({ firstTop: sections[0]?.top, stickyTop: stickyHeaderTop, scrollOffset: sharedValues?.scrollOffset }),
    [sections, stickyHeaderTop, sharedValues],
  );

  return (
    <View style={styles.fill}>
      <RecyclerList
        data={rows}
        scopeKey={scopeKey}
        listRef={listRef}
        scrollRef={scrollRef}
        keyExtractor={(row) => row.key}
        // Distinct pools per row type, so a heading never recycles into an items row (and vice versa).
        getItemType={(row) => row.type}
        getFixedItemSize={(row) => (row.type === 'header' ? RowHeight : rowHeight)}
        // `renderItem` hides the heading the pinned copy stands in for — see RecyclerList's extraData.
        extraData={pinnedKey}
        estimatedItemSize={rowHeight}
        header={header}
        paddingTop={paddingTop}
        paddingBottom={paddingBottom}
        sidePad={sidePad}
        sharedValues={sharedValues}
        onScroll={onScroll}
        renderItem={({ item: row }) =>
          row.type === 'header' ? (
            <SectionHeader label={row.label} count={row.count} hidden={row.key === pinnedKey} pin={pin} />
          ) : (
            renderRow(row.items)
          )
        }
      />
      {stickyHeaderTop !== undefined && sharedValues && (
        <StickySectionHeader
          sections={sections}
          stickyTop={stickyHeaderTop}
          // The row centres its own text in `RowHeight`, so the band needs no padding of its own.
          contentHeight={RowHeight}
          sidePad={sidePad}
          resetKey={scopeKey}
          scrollOffset={sharedValues.scrollOffset}
          onActiveChange={onActiveChange}
          {...(stickyPinned && { pinnedValue: stickyPinned })}
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
});
