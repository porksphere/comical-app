/**
 * The series-screen "Download" action. States driven by the download manifest AND the full chapter
 * list (so a partial download never masquerades as complete):
 *  - nothing downloaded → "Download", opens the download sheet (all / unread / next 10 / select).
 *  - in progress → a progress radial + status; tapping opens the Downloads screen focused on this
 *    series (expanded + scrolled into view) so the user can watch/cancel it.
 *  - partial (M of N logical chapters kept, nothing in flight) → "⤓ M / N", opens the sheet.
 *  - every chapter downloaded → "Downloaded"; tapping opens the Downloads screen to manage it.
 * Direct (chapterless) series are a single unit and keep the instant two-state behavior.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { DownloadStateVisual } from '@/components/downloads/download-status-indicator';
import { useAnchoredOverlay } from '@/components/overlay/overlay';
import { ActionButton } from '@/components/series/action-button';
import { DownloadSheet } from '@/components/series/download-sheet';
import { dlGetSeries } from '@/data/api';
import { deriveSeriesState, seriesFraction } from '@/data/downloads/derive';
import { enqueueChapter } from '@/data/downloads/engine';
import { queryKeys } from '@/data/queries';
import type { Chapter } from '@/data/types';
import { groupChapters } from '@/lib/chapter-order';

export function SeriesDownloadButton({
  bridgeId,
  seriesId,
  direct,
  title,
  cover,
  author,
  chapters,
}: {
  bridgeId: string;
  seriesId: string;
  direct: boolean;
  title: string;
  cover?: string;
  author?: string;
  /** The series' chapters (undefined while the list still loads); unused for a direct series. */
  chapters?: Chapter[];
}) {
  const router = useRouter();
  const { ref, openAt } = useAnchoredOverlay();

  const { data } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });

  // Progress comes from this query, which the events pipe patches page-by-page — so the radial
  // advances through the reliable useQuery subscription.
  const downloaded = data?.chapters ?? [];
  const state = downloaded.length > 0 ? deriveSeriesState(downloaded) : undefined;
  const inProgress = state !== undefined && state !== 'complete';
  const frac = seriesFraction(downloaded);

  // Manifest vs. the FULL chapter list, on logical chapters: how much of the series is actually
  // kept. Without this, 15-of-50 fully downloaded reads as "Downloaded".
  const groups = chapters ? groupChapters(chapters) : undefined;
  const completeIds = new Set(downloaded.filter((c) => c.state === 'complete').map((c) => c.chapterId));
  const completeGroups = groups ? groups.filter((g) => g.versions.some((v) => completeIds.has(v.id))).length : 0;
  const totalGroups = groups?.length ?? 0;
  const partial = !direct && state === 'complete' && totalGroups > 0 && completeGroups < totalGroups;

  // A chaptered series needs its chapter list loaded before the sheet can offer anything.
  const ready = direct || (chapters !== undefined && chapters.length > 0);

  const openDownloads = () => router.push(`/downloads?focus=${encodeURIComponent(`${bridgeId}:${seriesId}`)}`);
  const openSheet = () =>
    openAt(() => (
      <DownloadSheet
        bridgeId={bridgeId}
        seriesId={seriesId}
        title={title}
        {...(cover !== undefined && { cover })}
        {...(author !== undefined && { author })}
        {...(chapters !== undefined && { chapters })}
      />
    ));

  let button;
  if (inProgress) {
    // Keep the label short — a per-chapter count overflows the button; the radial shows progress.
    const label = state === 'paused' ? 'Paused' : state === 'failed' ? 'Failed' : 'Downloading';
    button = (
      <ActionButton
        testID="series.action.download"
        label={label}
        leading={<DownloadStateVisual state={state} fraction={frac} size={16} strokeWidth={2} />}
        onPress={openDownloads}
      />
    );
  } else if (state === 'complete' && !partial) {
    button = <ActionButton testID="series.action.download" label="✓  Downloaded" onPress={openDownloads} />;
  } else if (partial) {
    button = (
      <ActionButton
        testID="series.action.download"
        label={`⤓  ${completeGroups} / ${totalGroups}`}
        onPress={openSheet}
        disabled={!ready}
      />
    );
  } else if (direct) {
    // A direct series is one unit — no selection to offer; enqueue immediately as before.
    const enqueueDirect = () =>
      void enqueueChapter({
        bridgeId,
        seriesId,
        chapterId: seriesId,
        direct: true,
        title,
        ...(cover && { thumbnailUrl: cover }),
        ...(author && { author }),
      });
    button = <ActionButton testID="series.action.download" label="⤓  Download" onPress={enqueueDirect} disabled={!ready} />;
  } else {
    button = <ActionButton testID="series.action.download" label="⤓  Download" onPress={openSheet} disabled={!ready} />;
  }

  // The wrapping View anchors the desktop popover to the button (see useAnchoredOverlay).
  return (
    <View ref={ref} collapsable={false}>
      {button}
    </View>
  );
}
