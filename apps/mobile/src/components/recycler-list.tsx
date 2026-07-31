import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import type { ReactElement, RefObject } from 'react';
import { Platform, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { notifyScrollBeginDrag, notifyScrollEndDrag, notifyScrollRest } from '@/lib/scroll-release';

/**
 * THE one virtualized-list primitive. Every scrolling list of cards/rows in the app — the uniform
 * `SeriesGrid` (Browse results, Search, Library, …) AND the heterogeneous `ContentFeed` (Browse's
 * composed home: rails + grid rows in one list) — is built on this, so the hard-won LegendList config
 * lives in exactly ONE place instead of being copy-pasted (which is precisely the drift the old
 * `SeriesGrid` comment warned about). A fix here lands on every list at once.
 *
 * Generic over the item type `T`. Callers supply `data` + how to render/size/key/type it and any
 * scroll-linked wiring they own (sliding bars, pull-to-refresh, the dim); they never touch the list
 * config below. Nearly every prop here is a fix for a specific, hard-won bug — see the inline notes.
 */
export function RecyclerList<T>({
  data,
  scopeKey,
  keyExtractor,
  renderItem,
  getItemType,
  getFixedItemSize,
  estimatedItemSize,
  numColumns = 1,
  columnWrapperStyle,
  recycleItems = true,
  drawDistance,
  listRef,
  header,
  footer,
  paddingTop,
  paddingBottom,
  sidePad,
  sharedValues,
  onScroll,
  onEndReached,
  onEndReachedThreshold = 0.6,
  onScrollEndDrag,
  onMomentumScrollEnd,
  wrapperStyle,
}: {
  data: T[];
  /** Identifies the current scope (bridge/page/query/…); folded into the list `key` so a scope
   *  change remounts cleanly (also a scroll-to-top moment). */
  scopeKey: string;
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: { item: T; index: number }) => ReactElement | null;
  /** Pools recycled views per returned tag, so unlike-shaped items don't recycle into each other.
   *  Omit for a uniform list (one implicit type). */
  getItemType?: (item: T, index: number) => string;
  /** Declare an item's size as KNOWN (skips measurement — no re-measure churn on scroll). Return
   *  undefined for items whose height must be measured. Omit entirely for a measured list. `type` is
   *  whatever `getItemType` returned (undefined when it's omitted). */
  getFixedItemSize?: (item: T, index: number, type: string | undefined) => number | undefined;
  /** Initial size guess for unmeasured items (and the fallback for `getFixedItemSize` undefineds). */
  estimatedItemSize: number;
  numColumns?: number;
  /** LegendList takes gap keys only here (column gap); the outer inset comes from `sidePad`. */
  columnWrapperStyle?: { gap?: number; rowGap?: number; columnGap?: number };
  recycleItems?: boolean;
  /** How far beyond the viewport (px) to keep items mounted (LegendList default 250). Lower = fewer
   *  off-screen items mounted at once — e.g. a rails feed, where each mounted rail eagerly loads its
   *  cover images. */
  drawDistance?: number;
  listRef?: RefObject<LegendListRef | null>;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  /** Space above the first row — typically the top bar's resting height (content scrolls behind it). */
  paddingTop: number;
  /** Space below the last row. */
  paddingBottom: number;
  /** Symmetric horizontal content padding (centres content in the full-width scroller). */
  sidePad: number;
  /** Feeds a `useSlidingBar`'s UI-thread scroll offset. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onMomentumScrollEnd?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Animated styles for the list wrapper — e.g. the pull-to-refresh shift and the refinement dim.
   *  Applied to a wrapping Animated.View rather than the list's own `style` (not typed for a
   *  Reanimated style). */
  wrapperStyle?: Parameters<typeof Animated.View>[0]['style'];
}) {
  // LegendList's web build resets its render state *during* render on an empty→non-empty data swap
  // after it has held data ("Cannot update a component while rendering a different component"). Fold
  // the empty↔populated boundary + column count into the key so a 0→N fill is always a FRESH mount's
  // initial render, which skips that path (a different column count is also a different layout, and a
  // scopeKey change is a scroll-to-top moment anyway).
  const listKey = `${numColumns}|${scopeKey}|${data.length > 0 ? 'full' : 'empty'}`;

  return (
    <Animated.View style={[styles.list, wrapperStyle]}>
      <AnimatedLegendList
        ref={listRef}
        key={listKey}
        style={styles.list}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemType={getItemType}
        getFixedItemSize={getFixedItemSize}
        estimatedItemSize={estimatedItemSize}
        numColumns={numColumns}
        columnWrapperStyle={columnWrapperStyle}
        // Recycle card/row instances rather than remounting per reuse (renderers must be recycle-safe).
        recycleItems={recycleItems}
        drawDistance={drawDistance}
        // Don't retro-correct offsets from size measurements — a visible bounce/jitter while flinging
        // otherwise. Fixed/known sizes make this safe.
        maintainVisibleContentPosition={{ data: false, size: false }}
        sharedValues={sharedValues}
        // WEB ONLY. Root-causes the "loading only resumes once you lift your finger" symptom: with no
        // `renderScrollComponent`, `@legendapp/list/reanimated`'s scroll bridge renders
        // `Animated.ScrollView` at the `scrollEventThrottle` LegendList hardcodes (0), and
        // react-native-web at throttle 0 fires `onScroll` only at gesture start and ~100ms after idle,
        // never during an active drag/momentum — so the visible range (and onEndReached) only advanced
        // once you let go. Passing ANY renderScrollComponent routes through the bridge's other branch,
        // which forces scrollEventThrottle: 1. On NATIVE we don't pass it: forcing throttle 1 there
        // just saturates the JS thread every frame during a fling, and the UI-thread `sharedValues`
        // offset works regardless.
        renderScrollComponent={
          Platform.OS === 'web' ? (scrollProps) => <Animated.ScrollView {...scrollProps} /> : undefined
        }
        // Plain (JS-thread) onScroll alongside `sharedValues` — callers use it to keep a sliding bar's
        // `maxScrollY` in sync, and to drive the tab-bar auto-hide.
        onScroll={onScroll}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{
          // Fill the viewport even when the items don't, so the WHOLE screen is draggable (and the
          // overscroll/pull-to-refresh can start anywhere), not just on the rows.
          flexGrow: 1,
          paddingTop,
          paddingBottom,
          paddingLeft: sidePad,
          paddingRight: sidePad,
        }}
        onEndReachedThreshold={onEndReachedThreshold}
        onEndReached={onEndReached}
        // Show the browser's native scrollbar on web; hidden on native, where it isn't idiomatic.
        showsVerticalScrollIndicator={Platform.OS === 'web'}
        // No native RefreshControl anywhere — pull-to-refresh is the custom overlay spinner. Android's
        // edge-stretch glow is suppressed so it doesn't fight the custom pull; iOS keeps its bounce
        // (that's what sources the pull there), and a release past the threshold fires via onScrollEndDrag.
        overScrollMode={Platform.OS === 'android' ? 'never' : undefined}
        // Gesture phases for the auto-hiding chrome: both bars commit to shown-or-hidden when the
        // scroll is RELEASED, not while it moves (see `lib/scroll-release`). Reported here, on the
        // one list primitive, so every list built on it feeds them without wiring anything — a
        // caller's own handler still runs after.
        onScrollBeginDrag={notifyScrollBeginDrag}
        onScrollEndDrag={(e) => {
          notifyScrollEndDrag();
          onScrollEndDrag?.(e);
        }}
        onMomentumScrollEnd={(e) => {
          notifyScrollRest();
          onMomentumScrollEnd?.(e);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
});
