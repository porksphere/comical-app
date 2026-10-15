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
 * Two more ways in, outside the save paths: turning the series toggle on offers to do the same for
 * everything already saved (`autoDownloadLibrary`), and the `autoNew` toggle downloads what each
 * library sync finds (`autoDownloadNewChapters`).
 *
 * Everything here is fire-and-forget: a save never waits on (or fails because of) its download.
 */
import { dlGetSeries, getActivity, getBridges, getLibrary, getSavedChapters, type ApiActivityItem } from '../api';
import { queryClient } from '../query-client';
import { queryKeys, seriesListQuery } from '../queries';
import type { DataSource } from '../source';
import type { Chapter, SeriesDetail } from '../types';
import { getPreferredGroup } from '@/lib/preferred-group';
import { logDiagnostic } from '@/lib/diagnostics';
import { persisted$, whenPersistLoaded } from '@/lib/observable';
import { DIRECT_DOWNLOAD_CHAPTER_ID } from './constants';
import { enqueueChapter, enqueueChapters } from './engine';
import { downloadPrefs$, getDownloadPrefsSync } from './prefs';
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
    await enqueueRemaining(series, list.chapters ?? []);
  })().catch((e) => report(e, `series bridge=${series.bridgeId} series=${series.seriesId}`));
}

async function enqueueRemaining(series: SeriesRef, chapters: Chapter[]): Promise<void> {
  if (chapters.length === 0) return;
  const manifest = await dlGetSeries(series.bridgeId, series.seriesId).catch(() => null);
  const groups = remaining(selectableGroups(chapters, manifest?.chapters));
  await enqueueChapters(series, toEnqueue(groups, getPreferredGroup()));
}

/** The chapter list the last library sync stored: what a sync just found, with no bridge call. */
async function savedChapters(bridgeId: string, seriesId: string): Promise<Chapter[]> {
  const saved = await getSavedChapters(bridgeId, seriesId);
  return (saved?.chapters ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    date: c.publishedAt ?? 0,
    ...(c.number !== undefined && { number: c.number }),
    ...(c.group !== undefined && { group: c.group }),
    ...(c.languageCode !== undefined && { languageCode: c.languageCode }),
  }));
}

/** What `autoDownloadLibrary` would take on, for the offer made when the series toggle goes on. */
export async function librarySize(): Promise<{ series: number; chapters: number }> {
  const library = (await getLibrary()) ?? [];
  return { series: library.length, chapters: library.reduce((n, s) => n + s.knownCount, 0) };
}

/**
 * Download every series already in the library, one at a time. Each reads the stored chapter list
 * and only asks the bridge for a series that has none (never synced), so a large library costs a
 * stored read per series rather than a bridge request. Series whose bridge isn't installed are
 * skipped. Resolves with how many series it enqueued.
 */
export async function autoDownloadLibrary(ds: DataSource, mock: boolean): Promise<number> {
  if (mock) return 0;
  const [library, bridges] = await Promise.all([getLibrary(), getBridges()]);
  const installed = new Map(bridges.map((b) => [b.id, b]));
  let count = 0;
  for (const entry of library ?? []) {
    const bridge = installed.get(entry.bridgeId);
    if (!bridge) continue;
    const series = withCover(mock, {
      bridgeId: entry.bridgeId,
      seriesId: entry.seriesId,
      title: entry.seriesTitle,
      ...(entry.thumbnailUrl !== undefined && { thumbnailUrl: entry.thumbnailUrl }),
      ...(entry.author !== undefined && { author: entry.author }),
    });
    try {
      if (bridge.capabilities.includes('direct')) {
        await enqueueChapter({ ...series, chapterId: DIRECT_DOWNLOAD_CHAPTER_ID, direct: true });
      } else {
        let chapters = await savedChapters(series.bridgeId, series.seriesId).catch(() => []);
        if (chapters.length === 0) {
          const q = seriesListQuery(ds, mock, series.bridgeId, series.seriesId, false, true);
          chapters = (await queryClient.fetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn })).chapters ?? [];
        }
        await enqueueRemaining(series, chapters);
      }
      count += 1;
    } catch (e) {
      report(e, `library bridge=${series.bridgeId} series=${series.seriesId}`);
    }
  }
  return count;
}

/** Feed items detected after this haven't been considered for `autoNew` yet. 0 = never stamped. */
const newChaptersSince$ = persisted$<number>('comical:dl:autoNewSince', 0);

/** Turning it on starts the watermark now: it downloads what comes out from here on, not the feed
 *  already sitting in Activity. */
export function setAutoNewChapters(on: boolean): void {
  if (on) newChaptersSince$.set(Date.now());
  downloadPrefs$.autoNew.set(on);
}

let newChaptersRun: Promise<void> | undefined;

/**
 * Download what library syncs found since the last pass; called after every sync. The watermark,
 * not the sync's own count, decides what's new — so chapters another device's sync put in the feed
 * are picked up too, and a missed pass catches up on the next. Read chapters are left alone. A
 * series that fails holds the watermark below its chapters so the next pass retries them; seeing a
 * succeeded one again is harmless, since a kept or queued chapter is never enqueued twice.
 */
export function autoDownloadNewChapters(mock: boolean): Promise<void> {
  if (mock) return Promise.resolve();
  newChaptersRun ??= downloadNewChapters()
    .catch((e) => report(e, 'new chapters'))
    .finally(() => {
      newChaptersRun = undefined;
    });
  return newChaptersRun;
}

async function downloadNewChapters(): Promise<void> {
  // The background task runs before anything has hydrated: an unloaded pref reads off, and an
  // unloaded watermark reads 0, which would restamp it to now and skip what the sync just found.
  await Promise.all([whenPersistLoaded(downloadPrefs$), whenPersistLoaded(newChaptersSince$)]);
  if (!getDownloadPrefsSync().autoNew) return;
  const since = newChaptersSince$.peek();
  if (since === 0) {
    // On without ever being stamped (a restored pref): start from now, as the toggle does.
    newChaptersSince$.set(Date.now());
    return;
  }
  const fresh = (await getActivity()).filter((a) => a.detectedAt > since);
  if (fresh.length === 0) return;
  let next = Math.max(...fresh.map((a) => a.detectedAt));
  const bySeries = new Map<string, ApiActivityItem[]>();
  for (const a of fresh) {
    if (a.read) continue;
    const key = JSON.stringify([a.bridgeId, a.seriesId]);
    bySeries.set(key, [...(bySeries.get(key) ?? []), a]);
  }
  const preferred = getPreferredGroup();
  for (const items of bySeries.values()) {
    const { bridgeId, seriesId, title, thumbnailUrl } = items[0]!;
    try {
      const ids = new Set(items.map((a) => a.chapterId));
      const chapters = await savedChapters(bridgeId, seriesId);
      const manifest = await dlGetSeries(bridgeId, seriesId).catch(() => null);
      const groups = selectableGroups(chapters, manifest?.chapters)
        .filter((g) => !g.settled && g.group.versions.some((v) => ids.has(v.id)))
        .map((g) => g.group);
      const series = withCover(false, { bridgeId, seriesId, title, ...(thumbnailUrl !== undefined && { thumbnailUrl }) });
      if (!(await enqueueChapters(series, toEnqueue(groups, preferred)))) throw new Error('enqueue failed');
    } catch (e) {
      report(e, `new chapters bridge=${bridgeId} series=${seriesId}`);
      next = Math.min(next, Math.min(...items.map((a) => a.detectedAt)) - 1);
    }
  }
  newChaptersSince$.set(next);
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
