import { useFocusEffect, useIsFocused } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SeriesDetailsPage } from '@/components/series/details-page';
import { SeriesReaderPage } from '@/components/series/reader-page';
import { type ReaderSequenceRun, type SeriesReaderParams } from '@/components/series/reader-types';
import { SearchLayer } from '@/components/series/search-layer';
import { type SeriesSplit } from '@/components/series/split-handoff';
import { useNativePush, useViewport } from '@/components/series/viewport';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useReaderSequence, type ReaderSequenceParams } from '@/hooks/use-reader-sequence';
import { traceJS } from '@/lib/gesture-trace';
import { IOS_PARALLAX_FRACTION } from '@/lib/ios-card-pop';
import { useLocalSearchParams, useRouter } from '@/lib/nav';
import { usePaneTab, usePaneTabLive } from '@/lib/pane-tab';
import { registerDrillSeries, registerOpenSearchLayer } from '@/lib/series-nav';
import { coverSeriesPane, setSeriesPaneTop, useSeriesPaneCovered } from '@/lib/series-pane';
import { useSeriesPaneWidth } from '@/lib/series-pane-context';

const IS_IOS = Platform.OS === 'ios';

type DrillEntry = { key: number } & ({ kind: 'series'; params: SeriesReaderParams } | { kind: 'search' });

// memo: pushing/popping a layer re-renders the route below — without this, every mounted page
// re-renders along with it for nothing.
const MemoSeriesDetailsPage = memo(SeriesDetailsPage);
const MemoSeriesReaderPage = memo(SeriesReaderPage);

/** The root `series/index`: the details page of the split (see SeriesSplit). */
export default function SeriesDetailsScreen() {
  return <SeriesRoute split="details" />;
}

/** A tab's `series/index`: on iOS, the details page of the split (see SeriesSplit). */
export function SeriesTabScreen() {
  return <SeriesRoute split="details" />;
}

/** `series/read`, the root's and a tab's: the reader page of the split. */
export function SeriesReadScreen() {
  return <SeriesRoute split="reader" />;
}

/**
 * The page for the route's params, plus one LAYER per series drilled from it (related rails, nested
 * search results) or tag search opened over it, stacked as sibling views inside this one screen.
 * Layers, not navigation: the root route is a contained transparent modal, and iOS can neither
 * stack a second one on top (UIKit re-roots the presentation and drops the middle screen's view)
 * nor keep a covered nested card's view alive (UINavigationController detaches it). Sibling views
 * can't be detached by anyone, so the parent series is GUARANTEED live beneath a drilled one, for
 * its swipe-away and back-swipe to reveal. A pushed card in a tab pushes instead (see `live`).
 *
 * The drill arrives through lib/series-nav's handler stack: series cards anywhere inside the page
 * call it, popping the nested stack back to this screen first from its sub-pages (see
 * useDrillRelatedSeries). Only the topmost page takes touches; the ones beneath stay live purely as
 * the see-through under its gestures.
 */
function SeriesRoute({ split: routeSplit }: { split: SeriesSplit }) {
  const params = useLocalSearchParams<SeriesReaderParams & ReaderSequenceParams>();
  const router = useRouter();
  const { width } = useViewport();
  const inPane = useSeriesPaneWidth() !== null;
  const nativePush = useNativePush();
  // A details page under its reader is still mounted (see app/series/_layout) and must stop
  // answering keys and back. iOS covers it with a real card, and reads `isTop` for its bar.
  const routeFocused = useIsFocused() || IS_IOS;
  const [drills, setDrills] = useState<DrillEntry[]>([]);
  // The pane stays mounted under a full-screen series page opened from it (see lib/series-pane).
  useEffect(() => (inPane ? undefined : coverSeriesPane()), [inPane]);
  const covered = useSeriesPaneCovered() && inPane;

  // ── Sequence mode (`seq=1`): the reader pages over a COLLECTION's saved pages ──
  // The screen's share is deliberately small: resolve the album (use-reader-sequence) and mount
  // ONE instance for its whole life — never re-keyed, so the pager inside it never remounts and a
  // series cross stays what it physically is: a page turn. Which series the chrome describes, and
  // whose details its Details button opens, is the reader page's business — it re-points them to
  // the visible entry, the way a stitched crossing relabels (see ReaderSequenceRun).
  const seq = useReaderSequence(params);
  // A reading link that reached the details route (a deep link) still gets the reader page.
  const split: SeriesSplit = seq || params.reader === '1' ? 'reader' : routeSplit;
  const seqEntries = seq?.entries;
  const seqUris = seq?.uris;
  const seqStartId = params.seqStart;
  // The tapped tile's entry (a cold deep link whose seqStart no longer exists falls back to the
  // first entry rather than failing). Stable: the album roster is latched for the open's life.
  const seqStartIndex = useMemo(() => {
    if (!seqEntries?.length) return 0;
    const at = seqStartId ? seqEntries.findIndex((e) => e.id === seqStartId) : -1;
    return at >= 0 ? at : 0;
  }, [seqEntries, seqStartId]);
  const seqEntry = seqEntries?.[seqStartIndex];
  const seqRun = useMemo<ReaderSequenceRun | undefined>(
    () =>
      seqUris && seqEntries?.length
        ? { uris: seqUris, entries: seqEntries, index: seqStartIndex }
        : undefined,
    [seqUris, seqEntries, seqStartIndex],
  );
  // The page's route-level identity: the entry the album OPENED on — an ordinary reader-first
  // open, the same params a History row pushes, minus a chapter seed (the sequence, not a
  // chapter, is the page list). It never changes mid-album; the visible entry drives the rest.
  const seqParams = useMemo<SeriesReaderParams>(
    () =>
      seqEntry
        ? {
            id: seqEntry.seriesId,
            bridgeId: seqEntry.bridgeId,
            title: seqEntry.seriesTitle,
            reader: '1',
            ...(seqEntry.chapterId === DIRECT_CHAPTER_ID && { direct: '1' }),
          }
        : {},
    [seqEntry],
  );
  // A sequence that resolves to nothing (every page un-saved elsewhere, a dead deep link) has
  // nothing to show — leave rather than strand a spinner.
  const seqEmpty = !!seq && seq.resolved && seq.entries.length === 0;
  useEffect(() => {
    if (seqEmpty) router.back();
  }, [seqEmpty, router]);
  const nextKey = useRef(1);
  // The stack's shape, in the trace. A layer bug is by definition about which of several mounted
  // pages is reacting, and a recording had no way to say what was even mounted.
  const drill = useCallback((p: Record<string, string>) => {
    setDrills((d) => {
      traceJS('layer', 'push.series', { depth: d.length + 1 });
      return [...d, { key: nextKey.current++, kind: 'series', params: p as SeriesReaderParams }];
    });
  }, []);
  const openSearch = useCallback(() => {
    setDrills((d) => {
      traceJS('layer', 'push.search', { depth: d.length + 1 });
      return [...d, { key: nextKey.current++, kind: 'search' }];
    });
  }, []);
  const popLayer = useCallback(() => {
    setDrills((d) => {
      traceJS('layer', 'pop', { from: d.length, left: d.length - 1 });
      return d.slice(0, -1);
    });
  }, []);
  // The handlers are a stack whose top answers, and another tab's pane stays mounted while hidden —
  // so only the one you can see holds them, re-taking the top when its tab comes back. Two things
  // say "hidden": a pane in a tab that isn't the active one, and — since every tab's stack keeps
  // its own series page — a copy in a tab that isn't the focused one. A page left open in another
  // tab is blurred, not gone, and while it held the top, a tag tapped on the page you could see
  // opened the search layer on the one you couldn't.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  // A pushed card holds neither: a related series pushes another card there, and the tag search
  // pushes its route (see useNativePush) — a handler left registered would turn both into layers.
  const live = usePaneTabLive() && focused && !nativePush;
  useEffect(() => (live ? registerDrillSeries(drill) : undefined), [drill, live]);
  useEffect(() => (live ? registerOpenSearchLayer(openSearch) : undefined), [openSearch, live]);
  // The IN-TREE push parallax, now serving the SEARCH layer alone: how much it covers what's under
  // it (0 off-screen, 1 fully arrived). The layer publishes it; everything beneath drifts left
  // against it, the way UIKit moves an outgoing screen. Drilled SERIES layers no longer write it —
  // they zoom out of the card that opened them rather than sliding in, and a parent shoved sideways
  // under something expanding in place read as two contradictory motions (the same reason the tabs
  // behind the whole modal lost their parallax — see lib/series-backdrop.ts). Search still
  // slides in from the edge, so it still gets the push treatment.
  //
  // One value serves any depth even though it only ever describes the top layer: the sole item a
  // reader can see beneath the top one is the item directly beneath it. Deeper items are fully
  // covered, so their reading it is invisible either way.
  const layerCover = useSharedValue(0);
  const layerParallax = useAnimatedStyle(
    () => ({ transform: [{ translateX: -IOS_PARALLAX_FRACTION * width * layerCover.value }] }),
    [width],
  );
  const top = drills.length - 1;
  // …and the push is only ON while the thing on top is the one that pushes. A drilled series zooms
  // out of its card, so everything under it holds still; when it closes, whatever it was covering
  // is exactly where it was left. Without this gate the layers beneath would SNAP sideways the
  // moment a series was drilled from search results, riding a value the search layer had parked
  // at 1 and the series would never move again.
  // Nor in the desktop pane, where the search arrives without a slide to drift against (see
  // SearchLayer) — and the pane doesn't clip, so the page would be shoved out over the rail.
  const pushed = !inPane && top >= 0 && drills[top].kind === 'search' ? layerParallax : null;
  const topEntry = top >= 0 ? drills[top] : null;
  const topParams = !topEntry ? params : topEntry.kind === 'series' ? topEntry.params : null;
  const topKey = topParams ? `${topParams.bridgeId ?? ''}:${topParams.id ?? ''}` : null;
  const paneTab = usePaneTab();
  useEffect(() => (inPane ? setSeriesPaneTop(paneTab, topKey) : undefined), [inPane, paneTab, topKey]);
  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.container, pushed]}
        pointerEvents={drills.length === 0 ? 'auto' : 'none'}>
        {seq ? (
          seqRun && seqEntry ? (
            // ONE page, never re-keyed: the pager inside lives for the whole album, so a series
            // cross is a plain page turn — the page re-points chrome and details to the visible
            // entry itself.
            <MemoSeriesReaderPage
              params={seqParams}
              depth={0}
              onPopLayer={popLayer}
              isTop={drills.length === 0 && !covered && routeFocused}
              nativePush={nativePush}
              sequence={seqRun}
            />
          ) : (
            // Cold deep link: the collection query hasn't answered yet (a warm cache resolves
            // synchronously and never shows this).
            <View style={styles.seqLoading}>
              <ActivityIndicator color="#fff" />
            </View>
          )
        ) : split === 'reader' ? (
          <MemoSeriesReaderPage
            params={params}
            depth={0}
            onPopLayer={popLayer}
            isTop={drills.length === 0 && !covered && routeFocused}
            nativePush={nativePush}
          />
        ) : (
          <MemoSeriesDetailsPage
            params={params}
            depth={0}
            onPopLayer={popLayer}
            isTop={drills.length === 0 && !covered && routeFocused}
            nativePush={nativePush}
          />
        )}
      </Animated.View>
      {drills.map((d, i) => (
        <Animated.View
          key={d.key}
          // The top layer is the one moving; it must not also ride the parallax it publishes.
          style={i === top ? StyleSheet.absoluteFill : [StyleSheet.absoluteFill, pushed]}
          pointerEvents={i === top ? 'auto' : 'none'}>
          {d.kind === 'series' ? (
            <MemoSeriesDetailsPage
              params={d.params}
              depth={i + 1}
              onPopLayer={popLayer}
              isTop={i === top && !covered && routeFocused}
              nativePush={false}
            />
          ) : (
            <SearchLayer onPopLayer={popLayer} coverSV={layerCover} isTop={i === top && !covered && routeFocused} />
          )}
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Transparent: the route is a contained transparent modal, and its pages fade out over the
    // screen beneath.
    backgroundColor: 'transparent',
  },
  // Sequence resolving on a cold deep link — the reader's black, so the page that replaces it
  // doesn't flash a background change.
  seqLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
});
