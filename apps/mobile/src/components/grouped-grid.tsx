import type { LegendListRef } from '@legendapp/list/react-native';
import { useMemo, useState, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { RecyclerList } from '@/components/recycler-list';
import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import type { GroupedRow } from '@/data/grouped-rows';
import { useTheme } from '@/hooks/use-theme';

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
 * THE grouped grid: pre-computed header/items rows over `RecyclerList`, plus the STICKY section
 * header. Both grouped surfaces — the collected grid and the library grid — render through this,
 * so the sticky machinery lives in exactly one place. Callers own what an items row LOOKS like
 * (`renderRow`) and how tall it is (`rowHeight`); headers are the shared `SectionHeader`.
 *
 * The sticky is an overlay rather than a list feature: list-level sticky rows pin to the scroll
 * viewport's top edge, which on these screens is UNDER the translucent top bar (content
 * deliberately scrolls behind it) — exactly where a header is useless. Every row's height is fixed
 * and known, so the current section is pure arithmetic on the scroll offset: a JS handler swaps
 * WHICH section shows (state changes only at boundaries), and the classic push-out ride is an
 * animated style on the UI-thread scroll offset the list already publishes. The overlay pins just
 * below the bar (`stickyHeaderTop`), clipped so the pushed-out header can't bleed up behind it.
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
  /** An items row's fixed height (headers are always `RowHeight`). Fixed sizes are what keep a
   *  sectioned list from re-measuring as it scrolls — and what make the sticky arithmetic exact. */
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
  /** Feeds the tab bar's UI-thread slide — and the sticky header's push-out ride. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** One items row's content. The caller lays the row out (widths, gaps, short-row alignment). */
  renderRow: (items: T[]) => ReactElement;
}) {
  const theme = useTheme();

  // ── The sticky header's arithmetic ─────────────────────────────────────────
  // Each section header's CONTENT offset (the y its row starts at, in scroll coordinates —
  // contentOffset 0 is the top of the padding). Fixed row heights make this exact, no measuring.
  const sections = useMemo(() => {
    if (stickyHeaderTop === undefined) return [];
    const out: { label: string; count: number; top: number }[] = [];
    let y = paddingTop;
    for (const row of rows) {
      if (row.type === 'header') out.push({ label: row.label, count: row.count, top: y });
      y += row.type === 'header' ? RowHeight : rowHeight;
    }
    return out;
  }, [rows, stickyHeaderTop, paddingTop, rowHeight]);

  // WHICH section is pinned — JS state, changed only at section boundaries (the per-frame ride is
  // the animated style below). -1 = none: at rest the first inline header is still below the bar,
  // and duplicating it there would read as two lists.
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
    // The LABEL is JS state and lags this UI-thread frame by one or two during a fast scroll. The
    // push below is computed for the section under the line NOW — applied to a lagging label it is
    // the wrong section's exit ride, and with several boundaries crossing in one fling that was a
    // visible spasm: stale texts jumping around inside the clip as they swapped. So the push only
    // animates when the two threads AGREE on the section; a label the scroll has already passed
    // holds fully pushed out (it had just finished exiting — continuity), and one the scroll has
    // backed up behind holds at rest, until the text catches up a frame later.
    if (idx !== activeSection) {
      return { transform: [{ translateY: idx > activeSection ? -RowHeight : 0 }] };
    }
    const next = sections[idx + 1];
    const push = next ? Math.min(0, next.top - line - RowHeight) : 0;
    return { transform: [{ translateY: Math.max(push, -RowHeight) }] };
  }, [scrollOffsetSV, sections, stickyHeaderTop, activeSection]);

  const sticky = activeSection >= 0 ? sections[activeSection] : undefined;

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
        onScroll={handleScroll}
        renderItem={({ item: row }) =>
          row.type === 'header' ? <SectionHeader label={row.label} count={row.count} /> : renderRow(row.items)
        }
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
