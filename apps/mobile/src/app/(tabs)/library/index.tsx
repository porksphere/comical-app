import type { LegendListRef } from '@legendapp/list/react-native';
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LibraryCollectionSelector, LibraryKindSelector } from '@/components/library-collection-selector';
import type { LibraryGridChrome } from '@/components/library/library-listing';
import { LibraryCollectionMenu, LibraryNativeToolbar } from '@/components/library/library-native-toolbar';
import { LibrarySavedControls, LibrarySavedView } from '@/components/library/library-saved-view';
import { LibrarySeriesControls, LibrarySeriesView } from '@/components/library/library-series-view';
import { type TabFilter, TabFilterField, TabFilterTrigger, useTabFilter } from '@/components/tab-filter';
import { TabTitleBar } from '@/components/tab-title-bar';
import { CollectionThumb } from '@/components/collections/collection-thumb';
import { HoldActionTarget } from '@/components/hold-action-target';
import { NativeTabHeader } from '@/components/native-tab-header';
import { BridgeThumbRadius, BridgeThumbSize, useSubtitleSelectorStyle } from '@/components/selector';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, BottomTabInset, Spacing } from '@/constants/theme';
import {
  ALL_VIEW_NAME,
  effectiveItemKind,
  ITEM_KIND_LABELS,
  type ItemKind,
  itemKindOptions,
  type KindsPresent,
  setSelectedCollection,
  setSelectedItemKind,
  useSelectedCollectionId,
  useSelectedItemKind,
} from '@/data/selected-collection';
import type { Collection } from '@/data/types';
import { useHasSidebar } from '@/hooks/use-content-width';
import { useSavedItemKinds } from '@/hooks/use-saved-item-kinds';
import { useCollections } from '@/hooks/use-collections';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { NATIVE_HEADER, useTopChromeHeight } from '@/hooks/use-native-header';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';

export default function LibraryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('library', listRef);
  // UI-thread scroll offset for the tab bar's slide — `sharedValues` feeds it, `onScroll` only
  // keeps the bottom-bounce measurement in sync. See use-hide-tab-bar-on-scroll.
  const { sharedValues, onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the (non-recycled) card grid — until
  // this flips, the list holds empty data and the header shows a skeleton.
  const ready = useDeferredMount();

  // What the tab is showing: All or a collection, narrowed to one kind. Shared, not local: the
  // sidebar's Collections group moves this too (see `selected-collection.ts`).
  const collection = useSelectedCollectionId();
  const selectedKind = useSelectedItemKind();
  const kindsPresent = useSavedItemKinds(collection);
  const kind = effectiveItemKind(kindsPresent, selectedKind);
  // Asked of the layout, not derived from width — see `useHasSidebar`.
  const railNav = useHasSidebar();

  // What's typed folds straight into the view's query, debounced since each term is a fetch.
  const filter = useTabFilter();
  const term = useDebouncedValue(filter.query.trim(), 200);

  const { collections } = useCollections();
  const viewName = collections.find((c) => c.id === collection)?.name ?? ALL_VIEW_NAME;
  const titleType = useSubtitleSelectorStyle();

  const headerHeight = useTopChromeHeight();

  // A pinned section heading sits flush under the bar and draws its own rule, so the bar YIELDS its
  // own while one is up — see the same wiring on Browse. A shared value rather than React state so
  // the two rules trade on the same frame instead of the bar's leaving a frame or two late.
  const stickyPinned = useSharedValue(0);
  const barRuleStyle = useAnimatedStyle(
    () => ({ borderBottomColor: stickyPinned.value ? 'transparent' : theme.barHairline }),
    [theme.barHairline],
  );
  // The pinned section's label, which the iOS bar shows as its title — see NativeTabHeader.
  const [section, setSection] = useState<string | null>(null);

  const chrome: LibraryGridChrome = {
    listRef,
    paddingTop: headerHeight + BarContentGap,
    paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
    // Flush to the bar's bottom edge, as on Browse — NOT the viewport top, which is behind the bar
    // (content scrolls under it).
    stickyHeaderTop: headerHeight,
    stickyPinned,
    ...(NATIVE_HEADER ? { onSectionChange: setSection } : {}),
    sharedValues,
    onScroll,
  };

  return (
    <ThemedView style={styles.container}>
      {kind === 'series' ? (
        <LibrarySeriesView collection={collection} term={term} ready={ready} chrome={chrome} />
      ) : (
        <LibrarySavedView collection={collection} kind={kind} term={term} ready={ready} chrome={chrome} />
      )}

      {/* The sort button lives in the bar's trailing slot in BOTH states, so it stays put and visible
          while filtering. Filtering only swaps the LEADING content — the list selector becomes a back
          button + field in place — and collapses the filter trigger (now redundant) beside sort. */}
      {NATIVE_HEADER ? (
        <LibraryNativeHeader
          collection={collection}
          collections={collections}
          viewName={viewName}
          kind={kind}
          kindsPresent={kindsPresent}
          selectedKind={selectedKind}
          railNav={railNav}
          filter={filter}
          scrollY={sharedValues.scrollOffset}
          section={section}
        />
      ) : (
        <TabTitleBar
          barStyle={barRuleStyle}
          leading={
            filter.open ? undefined : (
              <HoldActionTarget testID="library.nsfw-hold" size={BridgeThumbSize}>
                <CollectionThumb
                  view={collection}
                  name={viewName}
                  size={BridgeThumbSize}
                  style={styles.barThumb}
                />
              </HoldActionTarget>
            )
          }
          titleSlot={
            filter.open ? (
              <TabFilterField filter={filter} testID="library.search" placeholder="Filter library…" />
            ) : (
              // The rail lists the collections when it's showing, so the selector would be a second
              // control for one selection. Unlike Browse — whose `Home` selector is a different axis
              // and stays — this one IS the screen's heading, so it degrades to a plain title rather
              // than leaving the bar with nothing in it.
              <>
                {railNav ? (
                  <ThemedText numberOfLines={1} style={[styles.railTitle, titleType.label]}>
                    {viewName}
                  </ThemedText>
                ) : (
                  <LibraryCollectionSelector
                    value={collection}
                    collections={collections}
                    onChange={setSelectedCollection}
                  />
                )}
                <LibraryKindSelector
                  present={kindsPresent}
                  value={kind}
                  selected={selectedKind}
                  onChange={setSelectedItemKind}
                />
              </>
            )
          }
          right={
            <>
              <TabFilterTrigger filter={filter} testID="library.search" placeholder="Filter library…" />
              {kind === 'series' ? (
                <LibrarySeriesControls collection={collection} />
              ) : (
                <LibrarySavedControls collection={collection} kind={kind} />
              )}
            </>
          }
        />
      )}
    </ThemedView>
  );
}

/**
 * The iOS navigation bar, in Browse's shape: "<view> <kind>" as the fading inline title (and
 * the NSFW hold target) — the kind only while the view holds more than one, as Browse's is
 * "<bridge> <page>" — the view's mark as ONE bare leading button opening the collection and
 * kind menu (`LibraryCollectionMenu`), the search as the system search item, and the arranging
 * `⋯` trailing. The filter and sort are secondary to what's showing, so they share that one menu
 * (LibraryNativeToolbar). A pinned section's label takes the title's place once it has faded —
 * see NativeTabHeader.
 */
function LibraryNativeHeader({
  collection,
  collections,
  viewName,
  kind,
  kindsPresent,
  selectedKind,
  railNav,
  filter,
  scrollY,
  section,
}: {
  collection: string | null;
  collections: Collection[];
  viewName: string;
  kind: ItemKind;
  kindsPresent: KindsPresent;
  selectedKind: ItemKind;
  railNav: boolean;
  filter: TabFilter;
  scrollY: SharedValue<number>;
  section: string | null;
}) {
  const kinds = itemKindOptions(kindsPresent, selectedKind);
  return (
    <>
      <NativeTabHeader
        title={kinds.length > 1 ? `${viewName} ${ITEM_KIND_LABELS[kind]}` : viewName}
        scrollY={scrollY}
        section={section}
        filter={filter}
        placeholder="Filter library…"
        holdTestID="library.nsfw-hold"
        large
      />
      <LibraryCollectionMenu collection={collection} collections={collections} kind={kind} kinds={kinds} railNav={railNav} />
      <LibraryNativeToolbar collection={collection} kind={kind} />
    </>
  );
}

const styles = StyleSheet.create({
  railTitle: {
    flexShrink: 1,
    minWidth: 0,
    // The selector's own inset, so the title stands the same step off the tile either way.
    paddingHorizontal: Spacing.one,
  },
  barThumb: {
    borderRadius: BridgeThumbRadius,
  },
  container: {
    flex: 1,
  },
});
