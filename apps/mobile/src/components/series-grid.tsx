import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import type { ReactElement, RefObject } from 'react';
import { useMemo } from 'react';
import { Platform, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { BottomTabInset, Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { GRID_COLUMN_GAP, padWithSpacers, useGridLayout } from '@/hooks/use-grid-layout';

/**
 * A cell in a series grid. `spacer` cells pad a short final row so real cards keep their column
 * width. The bridge fields are per-item OVERRIDES of the grid-level `bridge`/`bridgeId`/`direct`
 * props: a single-bridge grid (Browse, Search) leaves them unset and passes the grid-level ones,
 * while a cross-bridge grid (the Library, whose entries come from many bridges) carries them on each
 * item. One rule — item wins if present — so there's no per-screen branch inside the cell.
 */
export type SeriesGridItem = SeriesEntry & {
  spacer?: boolean;
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
  /** Unpadded entries — spacers are added here, so callers never build them. */
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

  const data = useMemo(
    () => padWithSpacers<SeriesGridItem>(items, numColumns, (id) => ({ id, title: '', cover: '', spacer: true })),
    [items, numColumns],
  );

  // LegendList's web build resets its render state *during* render on an empty→non-empty data swap
  // after it has held data ("Cannot update a component while rendering a different component"). Fold
  // the empty↔populated boundary into the key so a 0→N fill is always a FRESH mount's initial render,
  // which skips that path. `numColumns` is in the key because a different column count is a different
  // grid layout, and `scopeKey` so a scope change (a scroll-to-top moment anyway) remounts cleanly.
  const listKey = `${numColumns}|${scopeKey}|${data.length > 0 ? 'full' : 'empty'}`;

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
        data={data}
        estimatedItemSize={estimatedCardHeight(cardWidth)}
        // `estimatedItemSize` is a deliberately rough hint (worst-case 3-line titles), so measured rows
        // routinely differ from it. LegendList's default `maintainVisibleContentPosition` (size:true)
        // reacts by retro-correcting the scroll offset — a visible bounce/jitter while flinging. Turn
        // it off so positions settle once measured instead of nudging the offset.
        maintainVisibleContentPosition={{ data: false, size: false }}
        keyExtractor={(item) => String(item.id)}
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
          paddingTop,
          paddingBottom: paddingBottom ?? BottomTabInset + Spacing.five,
          paddingLeft: sidePad,
          paddingRight: sidePad,
        }}
        renderItem={({ item }) =>
          item.spacer ? (
            <View style={styles.cell} />
          ) : (
            <View style={styles.cell}>
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
          )
        }
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
    flex: 1,
    // Row gap lives here: LegendList ignores contentContainerStyle `gap` vertically (items are
    // absolutely positioned), so each cell reserves the inter-row space itself. It's split across
    // top+bottom (4 + 12 = the same 16 between rows) rather than all on the bottom, because
    // LegendList's web row container is `contain: paint` — a card flush to the row's top edge has its
    // hover-lift clipped.
    paddingTop: Spacing.one,
    paddingBottom: Spacing.three - Spacing.one,
  },
});
