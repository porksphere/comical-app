import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { BookmarkIcon } from '@/components/icons/reader-icons';
import { openCollectionPicker } from '@/components/collection-picker';
import { PagedReader, type ReaderPageItem } from '@/components/reader/paged-reader';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ApiCollectionPageItem } from '@/data/api';
import { collectedQueryFor, collectionItemsQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useCollectedPageUris } from '@/hooks/use-collected-page-uris';
import { useReaderSettings } from '@/hooks/use-reader-settings';
import { useRouter } from '@/lib/nav';

/**
 * Full-screen flip-through of saved pages — the thing a grid of thumbnails can't give you.
 *
 * It pages over **the same list the grid is showing**, in the same order, so swiping carries you
 * from one series straight into the next saved page rather than stopping at a chapter boundary.
 * That is the whole point: these pages were saved across many series, and browsing them as one
 * sequence is what makes a collection feel like an album instead of a bookmark list.
 *
 * The list is not passed in — it is RE-QUERIED from the same key the grid used (collection, search,
 * sort, dir), so this screen reads straight out of the query cache and opens instantly, with no
 * serialising an array through navigation params. `startId` picks the entry point.
 *
 * Reuses `PagedReader` rather than reimplementing paging: it already owns the pinch/pan/tap gesture
 * composition, the `pagingEnabled` alignment invariants, and the recycling that makes a long list of
 * full-screen images affordable. Chapter-turn callbacks become no-ops here — there is no "next
 * chapter", the list itself is the sequence.
 */
export default function CollectedViewerScreen() {
  const params = useLocalSearchParams<{
    startId?: string;
    collection?: string;
    q?: string;
    sort?: string;
    dir?: string;
  }>();
  const ds = useDataSource();
  const mock = useMockActive();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [settings] = useReaderSettings();

  const { data } = useQuery(
    collectionItemsQuery(
      ds,
      mock,
      collectedQueryFor(
        { kind: 'collected', collection: params.collection ?? null },
        params.q ?? '',
        (params.sort as 'added' | 'series' | 'chapter') ?? 'added',
        (params.dir as 'asc' | 'desc') ?? 'desc',
      ),
    ),
  );

  // Only pages can be flipped through. A collection can hold series and chapters too, but neither
  // has an image of its own — they stay in the grid.
  const pages = useMemo(
    () => (data ?? []).filter((i): i is ApiCollectionPageItem => i.type === 'page'),
    [data],
  );
  const uris = useCollectedPageUris(pages);

  const startIndex = Math.max(
    0,
    pages.findIndex((p) => p.id === params.startId),
  );
  const [index, setIndex] = useState(startIndex);
  const current = pages[Math.min(index, pages.length - 1)];

  // A page whose URL hasn't resolved yet gets an empty string — `ReaderPage` renders its own
  // skeleton for that, so the pager keeps its geometry instead of collapsing a slot.
  const items = useMemo<ReaderPageItem[]>(
    () => pages.map((p, i) => ({ uri: uris.get(p.id) ?? '', key: p.id, pageNumber: i + 1 })),
    // `uris` is a fresh Map each render by design; its CONTENT is what matters, and it changes only
    // when a chapter's page list resolves — which also changes `pages`' query data identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above; keyed off `pages`
    [pages],
  );

  if (pages.length === 0) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <PagedReader
        pages={items}
        width={width}
        height={height}
        rtl={false}
        pageFit={settings.pageFit}
        initialPage={startIndex}
        onPageChange={setIndex}
        // There is no chapter beyond this list — an edge swipe simply rubber-bands.
        onPrev={() => {}}
        onNext={() => {}}
        onToggleChrome={() => {}}
      />

      <View style={[styles.chrome, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable
          testID="collected-viewer.back"
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel="Close">
          <ChevronLeftIcon color="#fff" />
        </Pressable>

        <View style={styles.titles}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            {current?.seriesTitle ?? ''}
          </ThemedText>
          <ThemedText type="small" numberOfLines={1} style={styles.subtitle}>
            {[current?.chapterName, current && `Page ${current.pageIndex + 1}`, `${index + 1}/${pages.length}`]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>
        </View>

        <Pressable
          testID="collected-viewer.collections"
          onPress={() => {
            if (!current) return;
            openCollectionPicker({
              kind: 'page',
              bridgeId: current.bridgeId,
              seriesId: current.seriesId,
              chapterId: current.chapterId,
              pageIndex: current.pageIndex,
              title: current.chapterName
                ? `${current.seriesTitle} — ${current.chapterName}`
                : current.seriesTitle,
              snapshot: () => ({
                seriesTitle: current.seriesTitle,
                ...(current.chapterName !== undefined && { chapterName: current.chapterName }),
                ...(current.pageCount !== undefined && { pageCount: current.pageCount }),
                ...(current.sourceUrl !== undefined && { sourceUrl: current.sourceUrl }),
              }),
            });
          }}
          hitSlop={12}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel="Collections for this page">
          <BookmarkIcon color="#fff" size={20} filled />
        </Pressable>
      </View>

      <Pressable
        testID="collected-viewer.open-in-reader"
        onPress={() => {
          if (!current) return;
          // Replace, not push: the viewer and the reader are two ways of looking at the same page,
          // so backing out of the reader should land where the viewer was opened FROM, not stack a
          // second full-screen surface behind it.
          router.replace({
            pathname: '/series',
            params: {
              id: current.seriesId,
              bridgeId: current.bridgeId,
              reader: '1',
              chapterId: current.chapterId,
              start: String(current.pageIndex),
              title: current.seriesTitle,
            },
          });
        }}
        style={[styles.readerButton, { bottom: insets.bottom + Spacing.four }]}
        accessibilityRole="button"
        accessibilityLabel="Open in reader">
        <ThemedText type="small" style={styles.readerButtonText}>
          Open in reader
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  // Always-visible chrome, unlike the reader's auto-hiding bar: this is a browsing surface, not a
  // reading one, and the title is what tells you which series the page you're looking at came from.
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  button: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    maxWidth: '100%',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  readerButton: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  readerButtonText: {
    color: '#fff',
  },
});
