import type { LegendListRef } from '@legendapp/list/react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { GridSkeleton } from '@/components/grid-skeleton';
import { RetryBlock } from '@/components/retry-block';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useGridLayout } from '@/hooks/use-grid-layout';

/**
 * Everything a Library view's grid takes from the SCREEN rather than from its own data — the bar
 * it scrolls under, the tab bar it hides, the list the tab reselect scrolls to top. Both grids
 * (`SeriesGrid`, `CollectedItemsGrid`) take these under the same names, so a view spreads it whole.
 */
export type LibraryGridChrome = {
  listRef: RefObject<LegendListRef | null>;
  paddingTop: number;
  paddingBottom: number;
  stickyHeaderTop: number;
  stickyPinned: SharedValue<number>;
  /** iOS only: the pinned section's label, for the bar's title — see `GroupedGrid`. */
  onSectionChange?: (label: string | null) => void;
  sharedValues: { scrollOffset: SharedValue<number> };
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

/** What every Library view is handed: which view, the typed filter, and the screen's chrome. */
export type LibraryViewProps = {
  /** A collection's id, or `null` for All. */
  collection: string | null;
  /** The debounced filter text. */
  term: string;
  /** False while the tab swap paints — the grid holds no rows and the header shows a skeleton. */
  ready: boolean;
  chrome: LibraryGridChrome;
};

export type ListingMessage = [title: string, detail: string];

export const COLLECTION_EMPTY: ListingMessage = [
  'This collection is empty',
  'Save a series, chapter, or page into it — while reading, tap the bookmark in the top bar.',
];

/** "A", "A or B", "A, B or C" — the filter's ticks, as an empty grid names them. */
export function orList(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/**
 * The grid header for a listing that has nothing to show yet, in the order every Library view
 * resolves it: a failure, then loading, then a server with no library (`data === null`), then an
 * empty result. `null` once there is something to show.
 */
export function listingStatus({
  query,
  ready,
  count,
  failed,
  unavailable,
  empty,
}: {
  query: { error: Error | null; isLoading: boolean; data: unknown; refetch: () => unknown };
  ready: boolean;
  /** How many items survive every client-side rule (NSFW hiding), not how many came back. */
  count: number;
  /** The retry message when the error carries none. */
  failed: string;
  unavailable: ListingMessage;
  empty: () => ListingMessage;
}): ReactElement | null {
  if (query.error) {
    return (
      <View style={styles.stateBlock}>
        <RetryBlock message={query.error.message || failed} onRetry={() => void query.refetch()} />
      </View>
    );
  }
  if (!ready || query.isLoading || query.data === undefined) return <ListingSkeleton />;
  if (query.data === null) return <EmptyState message={unavailable} />;
  if (count === 0) return <EmptyState message={empty()} />;
  return null;
}

function ListingSkeleton() {
  const { numColumns } = useGridLayout();
  return <GridSkeleton numColumns={numColumns} />;
}

function EmptyState({ message: [title, detail] }: { message: ListingMessage }) {
  return (
    <View style={styles.empty}>
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDetail}>
        {detail}
      </ThemedText>
    </View>
  );
}

/**
 * Re-fetch when the tab regains focus, to reflect adds and removes made on a series page or in the
 * reader. Skips the first focus — the query has only just fetched.
 */
export function useRefetchOnRefocus(refetch: () => unknown) {
  const [focusedOnce, setFocusedOnce] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce) void refetch();
      else setFocusedOnce(true);
    }, [focusedOnce, refetch]),
  );
}

/**
 * Query options that hold the previous result across a REFINEMENT of one view (a new search term,
 * sort or filter) but never across a switch to another view — that would show the last view's
 * contents under the new one's name.
 */
export function holdWithinView(view: string) {
  return {
    meta: { view },
    placeholderData: <T,>(prev: T | undefined, prevQuery?: { meta?: Record<string, unknown> }) =>
      prevQuery?.meta?.view === view ? prev : undefined,
  };
}

const styles = StyleSheet.create({
  stateBlock: {
    paddingTop: Spacing.five,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.six,
  },
  emptyTitle: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyDetail: {
    textAlign: 'center',
    maxWidth: 320,
  },
});
