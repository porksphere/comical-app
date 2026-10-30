import { useQuery } from '@tanstack/react-query';
import type { ImageLoadEventData } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { LegacyComposedGesture as ComposedGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RetryBlock } from '@/components/retry-block';
import { SeriesRemovedNotice } from '@/components/series/series-removed';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { seriesGoneReason } from '@/data/api';
import { seriesDetailQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { Chapter } from '@/data/types';
import { sizeClassFor } from '@/hooks/use-responsive';
import { DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import type { ZoomRect } from '@/lib/series-zoom';
import { SeriesBody } from '@/components/series/series-body';

/** The details card's content: series.tsx's SeriesBody, fed exactly the way SeriesScreen feeds it
 *  (same detail query + placeholder seeding, same cover-aspect measurement, same layout inputs) —
 *  minus the TopBar/pull-to-refresh, plus the three intent overrides that route back into the
 *  in-place reader. */
export function SeriesDetailsHost({
  bridgeId,
  id,
  title,
  bridge,
  cover,
  defer,
  isDirect,
  width,
  topInset,
  sharedValues,
  onScrollEndDrag,
  onStartReading,
  onOpenChapter,
  onOpenPage,
  scrollGesture,
  scrollEnabled,
  onHeroCoverRect,
  coverAspectSeed,
  saveKeyEnabled,
}: {
  bridgeId?: string;
  id?: string;
  title?: string;
  bridge?: string;
  cover?: string;
  /** True while the instance's series queries are deferred (sequence mode, details not yet
   *  revealed) — the detail fetch waits with them. */
  defer?: boolean;
  isDirect: boolean;
  width: number;
  /** Overrides the default content top inset (safe area + breathing room) — the screen passes
   *  the full strip height, so the content starts below the reader band. */
  topInset?: number;
  sharedValues: Parameters<typeof SeriesBody>[0]['sharedValues'];
  /** Release of a details-list drag — the screen's iOS reveal pull commits on it. */
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onStartReading: () => void;
  onOpenChapter: (version: Chapter) => void;
  onOpenPage: (pageIndex: number) => void;
  /** The tapped card's aspect, so the hero starts the right shape — see the note on `coverAspect`. */
  coverAspectSeed?: number;
  /** Reports the details page's hero cover rect — the zoom's destination bound (see zoomGeom). */
  onHeroCoverRect?: (rect: ZoomRect) => void;
  /** The instance's `detailsScrollGesture` — mounted on SeriesBody's scroller (see makeBackSwipePan). */
  scrollGesture?: ComposedGesture;
  /** False while a horizontal details gesture is active, so the list can't scroll under it. */
  scrollEnabled?: boolean;
  saveKeyEnabled?: boolean;
}) {
  const ds = useDataSource();
  const mock = useMockActive();
  const insets = useSafeAreaInsets();
  const {
    data: series = null,
    error: queryError,
    isPlaceholderData,
    isFetching,
    refetch,
  } = useQuery({
    ...seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: isDirect,
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
    // Deferred until the instance's reveal latch flips (sequence mode) — this host mounts with
    // the details layer, which exists from the first frame, but must not fetch on its behalf.
    enabled: !!id && !defer,
  });

  // The hero cover's measured aspect. SEEDED from the card this page grew out of rather than from
  // the flat 2:3 placeholder, because this box is the zoom's DESTINATION BOUND and that bound is
  // latched on its first layout — a bridge whose covers aren't 2:3 therefore had a source rect at
  // the real shape aligning to a destination still sitting at the placeholder's, and a single
  // uniform scale cannot map one rectangle onto a differently-proportioned one. The card already
  // knows the answer (its own cover has loaded; that is how you could see it to tap it), so start
  // where it is. `onCoverLoad` still corrects it if the detail cover genuinely differs.
  const [coverAspect, setCoverAspect] = useState(() => coverAspectSeed ?? DEFAULT_THUMB_ASPECT);
  const onCoverLoad = (e: ImageLoadEventData) => {
    const src = e.source;
    if (!src?.width || !src.height) return;
    const ratio = src.width / src.height;
    const next = !Number.isFinite(ratio) || ratio <= 0 ? DEFAULT_THUMB_ASPECT : Math.min(2.5, Math.max(0.5, ratio));
    setCoverAspect((prev) => (Math.abs(next - prev) > 0.02 ? next : prev));
  };

  const isLarge = sizeClassFor(width) === 'regular';
  const actionsWidth = Math.round(Math.min(width * 0.4, 220));

  const goneReason = seriesGoneReason(queryError);
  if (queryError && goneReason !== undefined) {
    return (
      <View style={styles.centerFill}>
        <SeriesRemovedNotice
          bridgeName={bridge ?? ''}
          title={title ?? series?.title ?? ''}
          reason={goneReason}
          confirmed
          saved={false}
          checking={isFetching}
          onCheckAgain={() => void refetch()}
        />
      </View>
    );
  }
  if (queryError) {
    return (
      <View style={styles.centerFill}>
        <RetryBlock message={(queryError as Error).message || 'Failed to load series'} onRetry={refetch} />
      </View>
    );
  }
  if (!series) {
    // No forwarded cover (deep link) and the fetch hasn't resolved — brief, so keep it plain.
    return (
      <View style={styles.centerFill}>
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      </View>
    );
  }
  return (
    <SeriesBody
      series={series}
      bridgeId={bridgeId}
      isLarge={isLarge}
      // position:sticky is a web full-page affordance — inside the card's own scroller it wouldn't
      // resolve against the viewport anyway.
      sticky={false}
      actionsWidth={actionsWidth}
      direct={isDirect}
      width={width}
      initialCover={cover}
      loading={isPlaceholderData}
      detailStarted={isFetching || !isPlaceholderData}
      coverAspect={coverAspect}
      onCoverLoad={onCoverLoad}
      // The screen's own layout clears the notch (the strip band), so only breathing room is
      // added when no explicit inset comes through.
      topInset={topInset ?? insets.top + Spacing.five}
      onStartReading={onStartReading}
      onOpenChapter={onOpenChapter}
      onOpenPage={onOpenPage}
      sharedValues={sharedValues}
      onScrollEndDrag={onScrollEndDrag}
      scrollGesture={scrollGesture}
      scrollEnabled={scrollEnabled}
      onHeroCoverRect={onHeroCoverRect}
      saveKeyEnabled={saveKeyEnabled}
    />
  );
}

const styles = StyleSheet.create({
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
