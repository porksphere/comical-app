import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { BookmarkIcon } from '@/components/icons/reader-icons';
import { openCollectionPicker } from '@/components/collection-picker';
import { PagedReader, type ReaderPageItem } from '@/components/reader/paged-reader';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ApiCollectionPageItem } from '@/data/api';
import { collectionItemsQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useCollectedPageUris } from '@/hooks/use-collected-page-uris';
import { releaseCommitted } from '@/lib/gesture-release';
import { hapticImpactLight } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';

/** How far an upward drag travels (with the finger, before resistance) to commit to the details. */
const DETAILS_COMMIT = 96;
/** Upward follow is damped — the page peeks, it doesn't leave. Downward follow is 1:1, because a
 *  dismissal should feel like carrying the page away, exactly as the reader's does. */
const UP_RESISTANCE = 0.4;

/**
 * Full-screen flip-through of saved pages — the thing a grid of thumbnails can't give you.
 *
 * It pages over **the same list the grid is showing**, in the same order, so swiping carries you
 * from one series straight into the next saved page rather than stopping at a chapter boundary.
 * The list is not passed in — it is RE-QUERIED from the same key the grid used (collection, search,
 * sort, dir), so this screen reads straight out of the query cache; `startId` picks the entry point.
 *
 * Vertical gestures mirror the reader's, because this surface looks like the reader and hands
 * expect it to behave like it:
 * - **drag DOWN** carries the page away and dismisses, back to the grid — the same release
 *   projection (`releaseCommitted`) every dismissal in the app decides with;
 * - **swipe UP** opens the SERIES DETAILS for the page on screen, the same direction that reveals
 *   details inside the reader. It pushes the real `/series` screen — the same UI, its own
 *   skeletons — and nothing about the series is fetched until the swipe commits.
 * Horizontal stays the pager's (failOffsetX hands it over), and the pan disables while pinch-zoomed
 * so a one-finger pan of a zoomed page never fights it.
 *
 * Reuses `PagedReader` rather than reimplementing paging: it already owns the pinch/pan/tap gesture
 * composition, the `pagingEnabled` alignment invariants, and the recycling that makes a long list of
 * full-screen images affordable. Chapter-turn callbacks become no-ops here — there is no "next
 * chapter", the list itself is the sequence. `pageFit` is pinned to `fit-page` (not the reader
 * setting): a browsing surface wants the whole page visible, and it keeps the vertical axis free
 * for the two gestures above instead of racing a fit-width content scroll.
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

  // The SAME query the grid used — same collection, search, sort and dir — so this reads straight
  // out of the cache. The grid always lives inside a collection now, so `collection` is always set.
  const { data } = useQuery(
    collectionItemsQuery(ds, mock, {
      collection: params.collection ?? '',
      sort: (params.sort as 'added' | 'series' | 'chapter') ?? 'added',
      dir: (params.dir as 'asc' | 'desc') ?? 'desc',
      ...(params.q ? { q: params.q } : {}),
    }),
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

  // ── Vertical gestures: down = dismiss, up = series details ────────────────
  const [zoomed, setZoomed] = useState(false);
  const dragY = useSharedValue(0);
  // Latched once a dismissal exit owns the animation — a late gesture must not fight it.
  const leaving = useSharedValue(false);

  const goBack = useCallback(() => router.back(), [router]);
  const openDetails = useCallback(() => {
    if (!current) return;
    hapticImpactLight();
    // The push happens AT the swipe — nothing about the series was fetched before this moment, and
    // the series screen opens on its own skeletons while its queries run. Push, not replace: the
    // details are a peek, and backing out should land back in this flip-through.
    router.push({
      pathname: '/series',
      params: { id: current.seriesId, bridgeId: current.bridgeId, title: current.seriesTitle },
    });
  }, [router, current]);

  const verticalPan = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(!zoomed)
      .onUpdate((e) => {
        if (leaving.value) return;
        // Downward follows 1:1; upward is a damped peek toward the details.
        dragY.set(e.translationY >= 0 ? e.translationY : e.translationY * UP_RESISTANCE);
      })
      .onEnd((e) => {
        if (leaving.value) return;
        if (e.translationY >= 0) {
          // Same projected-release rule as every dismissal in the app: where would this land?
          if (releaseCommitted(e.translationY, e.velocityY, height * 0.22)) {
            leaving.set(true);
            dragY.set(
              withTiming(height, { duration: 200 }, (finished) => {
                if (finished) runOnJS(goBack)();
              }),
            );
            return;
          }
        } else if (releaseCommitted(-e.translationY * UP_RESISTANCE, -e.velocityY, DETAILS_COMMIT)) {
          dragY.set(withSpring(0, { damping: 20, stiffness: 300 }));
          runOnJS(openDetails)();
          return;
        }
        dragY.set(withSpring(0, { damping: 20, stiffness: 300 }));
      });
    // Vertical drags only — horizontal belongs to the pager, and a diagonal settles fast.
    pan.activeOffsetY([-24, 24]).failOffsetX([-15, 15]);
    return pan;
  }, [zoomed, dragY, leaving, height, goBack, openDetails]);

  // The page follows the finger; the black backdrop thins as it goes, so the grid shows through —
  // the same read the reader's dismissal gives: you are carrying the page off the screen.
  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dragY.value },
      {
        scale: interpolate(Math.abs(dragY.value), [0, height], [1, 0.85], Extrapolation.CLAMP),
      },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.max(0, dragY.value), [0, height * 0.6], [1, 0], Extrapolation.CLAMP),
  }));

  if (pages.length === 0) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={verticalPan}>
        <Animated.View style={[styles.content, contentStyle]}>
          <PagedReader
            pages={items}
            width={width}
            height={height}
            rtl={false}
            pageFit="fit-page"
            initialPage={startIndex}
            onPageChange={setIndex}
            onZoomChange={setZoomed}
            // There is no chapter beyond this list — an edge swipe simply rubber-bands.
            onPrev={() => {}}
            onNext={() => {}}
            onToggleChrome={() => {}}
          />

          <View style={[styles.chrome, { paddingTop: insets.top + Spacing.two }]}>
            <Pressable
              testID="collected-viewer.back"
              onPress={goBack}
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
                {[
                  current?.chapterName,
                  current && `Page ${current.pageIndex + 1}`,
                  `${index + 1}/${pages.length}`,
                ]
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
              // Replace, not push: the viewer and the reader are two ways of looking at the same
              // page, so backing out of the reader should land where the viewer was opened FROM,
              // not stack a second full-screen surface behind it.
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
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  // Transparent root over a separate backdrop layer: the dismissal drag thins the backdrop so the
  // Library shows through UNDER the departing page (the route is a contained transparent modal).
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
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
