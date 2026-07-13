import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import type { ReactElement, RefObject } from 'react';
import { Platform, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { BottomTabInset, Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';

// A cell reserves the inter-row space itself (LegendList ignores vertical `gap` — items are absolutely
// positioned). Split top/bottom rather than all-bottom because LegendList's web row container is
// `contain: paint`, which would clip a card's hover-lift if it were flush to the row's top edge. These
// feed both `styles.cell`'s padding AND the fixed `cellHeight` below, so the two never drift.
const CELL_PAD_TOP = Spacing.one;
const CELL_PAD_BOTTOM = Spacing.three - Spacing.one;
const CELL_ROW_GAP = CELL_PAD_TOP + CELL_PAD_BOTTOM;

/**
 * A cell in a series grid. Every item is a REAL series — the grid never injects placeholder entries
 * into its data.
 *
 * The bridge fields are per-item OVERRIDES of the grid-level `bridge`/`bridgeId`/`direct` props: a
 * single-bridge grid (Browse, Search) leaves them unset and passes the grid-level ones, while a
 * cross-bridge grid (the Library, whose entries come from many bridges) carries them on each item.
 * One rule — item wins if present — so there's no per-screen branch inside the cell.
 */
export type SeriesGridItem = SeriesEntry & {
  bridge?: string;
  bridgeId?: string;
  direct?: boolean;
};

/**
 * THE series-card grid. Every screen that shows a grid of series cards (Browse, Search, Library)
 * renders this — there is no second LegendList-of-SeriesCards anywhere.
 *
 * This exists because the list's configuration is not obvious: nearly every prop below is a fix for a
 * specific, hard-won bug (web scroll throttling, fling jitter, the empty→populated web reset crash,
 * recycling safety, the Android overscroll glow fighting the custom pull). Those fixes were made on
 * the Browse/Search grids and were silently missing from the Library's hand-rolled copy. Keeping ONE
 * implementation is what stops that drift: a fix here lands on every grid at once.
 *
 * Layout (columns, side padding, card width) comes from `useGridLayout`, so every grid is laid out
 * identically and hydration-safely. Callers supply data + chrome (header/footer, content insets) and
 * any scroll-linked wiring they already own (sliding bars, pull-to-refresh, the dim), never their own
 * list config.
 */
export function SeriesGrid({
  items,
  scopeKey,
  listRef,
  header,
  footer,
  paddingTop,
  paddingBottom,
  bridge,
  bridgeId,
  direct,
  originPage,
  crossfading,
  sharedValues,
  onScroll,
  onEndReached,
  onScrollEndDrag,
  wrapperStyle,
}: {
  /** The series to show. Exactly what gets rendered — the grid adds nothing to it. */
  items: SeriesGridItem[];
  /** Identifies the current scope (bridge/page/query/sort/…). Feeds the list `key` and the cards'
   *  recycle `cohort`, so a scope change resets recycled card state instead of flashing the previous
   *  item's cover. */
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  /** Space above the first row — typically the top bar's resting height (content scrolls behind it). */
  paddingTop: number;
  /** Space below the last row. Defaults to clearing the tab bar + the safe area. */
  paddingBottom?: number;
  /** Grid-level bridge identity, used for every item that doesn't carry its own (see SeriesGridItem). */
  bridge?: string;
  bridgeId?: string;
  direct?: boolean;
  /** Browse only: the sub-page a card was opened from, so the series screen can return to it. */
  originPage?: string;
  /** Suppresses per-card entrance work while a full-surface crossfade owns the transition. */
  crossfading?: boolean;
  /** Feeds a `useSlidingBar`'s UI-thread scroll offset. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached?: () => void;
  /** From `usePullToRefresh` — iOS releases past the pull threshold fire the refresh. */
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Animated styles for the list wrapper — e.g. the pull-to-refresh content shift and the
   *  refinement dim. Applied to a wrapping Animated.View rather than the list's own `style`, which
   *  isn't typed for a Reanimated style. */
  wrapperStyle?: Parameters<typeof Animated.View>[0]['style'];
}) {
  const { numColumns, sidePad, cardWidth } = useGridLayout();

  // FIXED row height — this is the fix for the release profile's #1 JS cost. Every cell is forced to
  // the SAME height (worst-case card content = 3-line title + sub, via `estimatedCardHeight`, plus the
  // cell's own vertical padding `CELL_ROW_GAP`). With every row identical AND matching
  // `estimatedItemSize` exactly, LegendList never re-measures a row on scroll — so no `set$` /
  // `updateItemSizes` churn, no `batchedUpdates` re-render, and the `propagateParentContextChanges`
  // walk (20% of release busy time) + a chunk of GC collapse. Cards shorter than the worst case (1–2
  // line titles, no sub) just get a little empty space at the bottom; the cover's real aspect and the
  // title hugging it are unchanged.
  const cellHeight = estimatedCardHeight(cardWidth) + CELL_ROW_GAP;

  // LegendList's web build resets its render state *during* render on an empty→non-empty data swap
  // after it has held data ("Cannot update a component while rendering a different component"). Fold
  // the empty↔populated boundary into the key so a 0→N fill is always a FRESH mount's initial render,
  // which skips that path. `numColumns` is in the key because a different column count is a different
  // grid layout, and `scopeKey` so a scope change (a scroll-to-top moment anyway) remounts cleanly.
  const listKey = `${numColumns}|${scopeKey}|${items.length > 0 ? 'full' : 'empty'}`;

  return (
    <Animated.View style={[styles.list, wrapperStyle]}>
      <AnimatedLegendList
        ref={listRef}
        key={listKey}
        // Full-width scroller so the scrollbar sits at the window edge; content is centred by the
        // symmetric `sidePad` below instead.
        style={styles.list}
        sharedValues={sharedValues}
        // WEB ONLY. Root-causes the "loading only resumes once you lift your finger" symptom on web:
        // with no `renderScrollComponent`, `@legendapp/list/reanimated`'s internal scroll bridge
        // renders `Animated.ScrollView` with whatever `scrollEventThrottle` LegendList's own internal
        // ListComponent hardcodes — which is 0. At 0, react-native-web's ScrollView fires `onScroll`
        // once at gesture start and once ~100ms after it goes idle (its debounced `handleScrollEnd`),
        // never during an active drag/momentum — so the visible range (and onEndReached) only advances
        // once you let go. Passing ANY renderScrollComponent routes through the bridge's other branch,
        // which forces scrollEventThrottle: 1 — restoring continuous updates during the gesture.
        // On NATIVE we deliberately don't pass it: forcing throttle 1 there just saturates the JS
        // thread every frame during a fling, and the UI-thread `sharedValues` offset works regardless.
        renderScrollComponent={
          Platform.OS === 'web' ? (scrollProps) => <Animated.ScrollView {...scrollProps} /> : undefined
        }
        // Plain (JS-thread) onScroll alongside `sharedValues` — callers use it to keep a sliding bar's
        // `maxScrollY` in sync, and to drive the tab-bar auto-hide.
        onScroll={onScroll}
        data={items}
        // EXACT, not a hint: every cell is pinned to `cellHeight` below, so this matches every measured
        // row and LegendList never re-anchors or re-measures on scroll (see `cellHeight`).
        estimatedItemSize={cellHeight}
        // Belt-and-suspenders: don't retro-correct the offset from size measurements (there shouldn't
        // be any now that rows are fixed) — a visible bounce/jitter while flinging otherwise.
        maintainVisibleContentPosition={{ data: false, size: false }}
        // A series is identified by its BRIDGE plus its id, never its id alone — the same identity
        // history.tsx and activity.tsx key by. It matters here because the Library is a cross-bridge
        // grid (see `SeriesGridItem`): two bridges can hand out the same `seriesId` for unrelated
        // series, and keying on `id` alone hands LegendList duplicate keys the moment both are in the
        // library. Browse/Search are single-bridge and leave `bridgeId` unset, so their keys are
        // unchanged.
        keyExtractor={(item) => (item.bridgeId ? `${item.bridgeId}:${item.id}` : String(item.id))}
        numColumns={numColumns}
        // Recycle card instances rather than remounting per reuse — SeriesCard is recycle-safe (it
        // resets its per-item state synchronously on entry change), so scrolling reuses cards instead
        // of paying a fresh heavy mount for every row that scrolls into view.
        recycleItems
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        // LegendList takes gap keys only in columnWrapperStyle (column gap); the outer inset +
        // centering come from contentContainerStyle's paddingLeft/Right (= sidePad).
        columnWrapperStyle={numColumns > 1 ? { gap: GRID_COLUMN_GAP } : undefined}
        contentContainerStyle={{
          // Fill the viewport even when the items don't. Without this the scrollable content ends at
          // the last row, so the empty space below it belongs to nothing: a drag started down there
          // isn't on the scroller and does nothing — you have to start the gesture ON a card to
          // scroll or to pull the list. With flexGrow the content always spans the full height, so
          // the whole screen is draggable (and the overscroll stretch/pull-to-refresh can be started
          // anywhere), regardless of how few items there are.
          flexGrow: 1,
          paddingTop,
          paddingBottom: paddingBottom ?? BottomTabInset + Spacing.five,
          paddingLeft: sidePad,
          paddingRight: sidePad,
        }}
        renderItem={({ item }) => (
          // Both dimensions are FIXED — see `cellHeight` above, and `cardWidth` (from useGridLayout,
          // the same number the column count was derived from). The width is what lets a short final
          // row simply end: with an elastic `flex: 1` cell, a last row holding one of three columns
          // stretched that card across the whole row, which is why this grid used to append invisible
          // "spacer" items to pad the row out. Fake entries in a keyed, virtualized list are a bad
          // trade for a layout fix — they leak into the item type, the key space, and renderItem.
          <View style={[styles.cell, { width: cardWidth, height: cellHeight }]}>
            <SeriesCard
              entry={item}
              bridge={item.bridge ?? bridge}
              bridgeId={item.bridgeId ?? bridgeId}
              direct={item.direct ?? direct}
              originPage={originPage}
              cohort={scopeKey}
              crossfading={crossfading}
            />
          </View>
        )}
        onEndReachedThreshold={0.6}
        onEndReached={onEndReached}
        // Show the browser's native scrollbar on web (the list scrolls in its own overflow container);
        // hidden on native, where it isn't idiomatic.
        showsVerticalScrollIndicator={Platform.OS === 'web'}
        // No native RefreshControl on any platform — pull-to-refresh is the custom overlay spinner
        // (see `usePullToRefresh`), consistent everywhere. Android's edge-stretch glow is suppressed so
        // it doesn't fight the custom pull; iOS keeps its bounce (that's what sources the pull there),
        // and a release past the threshold fires the refresh via onScrollEndDrag.
        overScrollMode={Platform.OS === 'android' ? 'never' : undefined}
        onScrollEndDrag={onScrollEndDrag}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  cell: {
    // NO `flex: 1` — the cell is pinned to `cardWidth` at the call site. See the note in renderItem:
    // an elastic cell is what forced the old spacer-item hack.
    // Inter-row spacing (see CELL_PAD_TOP/BOTTOM above, shared with the fixed cellHeight so they can't
    // drift). `justifyContent: flex-start` so a card shorter than the fixed cell top-aligns, leaving
    // any extra space at the BOTTOM (below the title) — the cover + title-hugging stay put.
    justifyContent: 'flex-start',
    paddingTop: CELL_PAD_TOP,
    paddingBottom: CELL_PAD_BOTTOM,
  },
});
