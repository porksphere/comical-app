/**
 * The series-screen "Download" action. States driven by the download manifest AND the full chapter
 * list (so a partial download never masquerades as complete):
 *  - nothing downloaded → "Download", opens the chapter-selection screen (`/download-select`).
 *  - in progress → a progress radial + status; tapping opens the Downloads screen focused on this
 *    series (expanded + scrolled into view) so the user can watch/cancel it.
 *  - partial (M of N logical chapters kept, nothing in flight) → "⤓ M / N", opens the selection
 *    screen (settled chapters render checked-and-dimmed there).
 *  - every chapter downloaded → "Downloaded"; tapping opens the Downloads screen to manage it.
 * Direct (chapterless) series are a single unit and keep the instant two-state behavior — and, being
 * chapterless, their manage/watch tap goes to the Downloads screen's own row instead of a chapter
 * roster with nothing in it (see `downloads/nav.ts`).
 */
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { DownloadStateVisual } from '@/components/downloads/download-status-indicator';
import { ActionButton } from '@/components/series/action-button';
import { dlGetSeries } from '@/data/api';
import { deriveSeriesState, seriesFraction } from '@/data/downloads/derive';
import { enqueueChapter } from '@/data/downloads/engine';
import { downloadsScreenRoute } from '@/data/downloads/nav';
import { queryKeys } from '@/data/queries';
import type { Chapter } from '@/data/types';
import { groupChapters } from '@/lib/chapter-order';
import { useSeriesSubPath } from '@/lib/series-nav';
import { useRouter } from '@/lib/nav';

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

  // Chaptered series route to the per-series download screen — with `select=1` when the intent is
  // picking chapters to download, without it when it's watching/managing what's already there.
  // (`toSubPath` keeps the push inside the series page's nested stack when this button is on
  // that page — see useSeriesSubPath.)
  const toSubPath = useSeriesSubPath();
  const openSeriesDownloads = (select: boolean) =>
    router.push({
      pathname: toSubPath('/series-downloads'),
      params: {
        bridgeId,
        id: seriesId,
        title,
        all: '1',
        ...(select ? { select: '1' } : {}),
        ...(cover ? { cover } : {}),
        ...(author ? { author } : {}),
      },
    });
  // Watching/managing: a direct series has no chapter roster to open, so it goes to its row on the
  // Downloads screen; a chaptered one keeps the roster.
  const openDownloads = () => {
    if (!direct) {
      openSeriesDownloads(false);
      return;
    }
    const route = downloadsScreenRoute(bridgeId, seriesId);
    router.push({ ...route, pathname: toSubPath(route.pathname) });
  };
  const openSelect = () => openSeriesDownloads(true);

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
      <ActionButton testID="series.action.download" label={`⤓  ${completeGroups} / ${totalGroups}`} onPress={openSelect} />
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
    button = <ActionButton testID="series.action.download" label="⤓  Download" onPress={enqueueDirect} />;
  } else {
    button = <ActionButton testID="series.action.download" label="⤓  Download" onPress={openSelect} />;
  }

  return <View collapsable={false}>{button}</View>;
}
