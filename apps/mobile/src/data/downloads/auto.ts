/**
 * Auto-download: saving something to the library downloads it, per kind of item, when the matching
 * Settings → General toggle is on. Called by the save paths on the transition from unsaved to saved
 * only — re-filing a saved item must not re-download what the user may have deliberately deleted.
 *
 *  - series → every logical chapter not already kept or queued (the "Download all" set), or a direct
 *    series' single page set;
 *  - chapter → that chapter;
 *  - page → just that page, as a partial chapter (`onlyPages`), which a later whole-chapter download
 *    fills in around.
 *
 * Everything here is fire-and-forget: a save never waits on (or fails because of) its download.
 */
import { dlGetSeries } from '../api';
import { queryClient } from '../query-client';
import { queryKeys, seriesListQuery } from '../queries';
import type { DataSource } from '../source';
import type { SeriesDetail } from '../types';
import { getPreferredGroup } from '@/lib/preferred-group';
import { logDiagnostic } from '@/lib/diagnostics';
import { DIRECT_DOWNLOAD_CHAPTER_ID } from './constants';
import { enqueueChapter, enqueueChapters } from './engine';
import { getDownloadPrefsSync } from './prefs';
import { remaining, selectableGroups, toEnqueue } from './select';

interface SeriesRef {
  bridgeId: string;
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  author?: string;
}

/** The series cover from whichever detail query is cached — chapter and page saves don't carry
 *  one, and the Downloads screen shows it on the series' row. */
function cachedCover(mock: boolean, bridgeId: string, seriesId: string): string | undefined {
  for (const direct of [false, true]) {
    const cover = queryClient.getQueryData<SeriesDetail>(queryKeys.seriesDetail(mock, bridgeId, seriesId, direct))?.cover;
    if (cover) return cover;
  }
  return undefined;
}

function withCover<T extends SeriesRef>(mock: boolean, ref: T): T {
  if (ref.thumbnailUrl) return ref;
  const cover = cachedCover(mock, ref.bridgeId, ref.seriesId);
  return cover ? { ...ref, thumbnailUrl: cover } : ref;
}

function report(e: unknown, context: string): void {
  logDiagnostic('auto-download', (e as Error)?.message || String(e), { context });
}

/** A series was just added to the library. `direct` must be known to download a chapterless
 *  series — without it, an empty chapter list just downloads nothing. */
export function autoDownloadSeries(ds: DataSource, mock: boolean, ref: SeriesRef & { direct?: boolean }): void {
  if (mock || !getDownloadPrefsSync().autoSeries) return;
  const series = withCover(mock, ref);
  if (ref.direct) {
    void enqueueChapter({ ...series, chapterId: DIRECT_DOWNLOAD_CHAPTER_ID, direct: true });
    return;
  }
  void (async () => {
    const q = seriesListQuery(ds, mock, series.bridgeId, series.seriesId, false, true);
    const list = await queryClient.fetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn });
    const chapters = list.chapters ?? [];
    if (chapters.length === 0) return;
    const manifest = await dlGetSeries(series.bridgeId, series.seriesId).catch(() => null);
    const groups = remaining(selectableGroups(chapters, manifest?.chapters));
    enqueueChapters(series, toEnqueue(groups, getPreferredGroup()));
  })().catch((e) => report(e, `series bridge=${series.bridgeId} series=${series.seriesId}`));
}

/** A chapter was just saved. */
export function autoDownloadChapter(
  mock: boolean,
  ref: SeriesRef & { chapterId: string; chapterName?: string; number?: number; languageCode?: string },
): void {
  if (mock || !getDownloadPrefsSync().autoChapters) return;
  void enqueueChapter(withCover(mock, ref));
}

/** A page was just saved. A direct series' pages are filed under the reserved direct chapter id. */
export function autoDownloadPage(
  mock: boolean,
  ref: SeriesRef & { chapterId: string; pageIndex: number; chapterName?: string },
): void {
  if (mock || !getDownloadPrefsSync().autoPages) return;
  const { pageIndex, ...rest } = withCover(mock, ref);
  void enqueueChapter({ ...rest, direct: ref.chapterId === DIRECT_DOWNLOAD_CHAPTER_ID, onlyPages: [pageIndex] });
}
