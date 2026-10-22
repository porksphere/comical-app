/**
 * Auto-download: saving something to the library downloads it, per kind of item, when the matching
 * Settings → General toggle is on and the item's bridge hasn't opted out of that kind in its own
 * settings (`autoDownloadsFor`). Called by the save paths on the transition from unsaved to saved
 * only — re-filing a saved item must not re-download what the user may have deliberately deleted.
 *
 *  - series → every logical chapter not already kept or queued (the "Download all" set), or a direct
 *    series' single page set;
 *  - chapter → that chapter;
 *  - page → just that page, as a partial chapter (`onlyPages`), which a later whole-chapter download
 *    fills in around.
 *
 * Three more ways in, outside the save paths: turning the series toggle on offers to do the same for
 * everything already saved (`autoDownloadLibrary`), a series another device saved arrives by sync
 * (`syncedSeriesBackfill`, see `./synced.ts`), and the `autoNew` toggle downloads what each library
 * sync finds (`autoDownloadNewChapters`).
 *
 * Everything here is fire-and-forget: a save never waits on (or fails because of) its download.
 */
import type { DownloadedChapter } from '@comical/downloads';

import {
  dlGetSeries,
  dlStorageUsage,
  getActivity,
  getBridges,
  getLibrary,
  getSavedChapters,
  type ApiActivityItem,
  type ApiCollectedSeries,
} from '../api';
import { queryClient } from '../query-client';
import { queryKeys, seriesListQuery } from '../queries';
import type { DataSource } from '../source';
import type { Chapter, SeriesDetail } from '../types';
import { getPreferredGroup } from '@/lib/preferred-group';
import { logDiagnostic } from '@/lib/diagnostics';
import { persisted$, whenPersistLoaded } from '@/lib/observable';
import { DIRECT_DOWNLOAD_CHAPTER_ID } from './constants';
import { enqueueChapter, enqueueChapters } from './engine';
import { autoDownloadsFor, bridgeAutoDownload$, downloadPrefs$, getDownloadPrefsSync } from './prefs';
import { remaining, selectableGroups, settled, toEnqueue } from './select';

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
  if (mock || !autoDownloadsFor(ref.bridgeId, 'autoSeries')) return;
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

/** Resolves with how many chapters it enqueued — 0 for a series already fully kept or queued. */
async function enqueueRemaining(series: SeriesRef, chapters: Chapter[]): Promise<number> {
  if (chapters.length === 0) return 0;
  const manifest = await dlGetSeries(series.bridgeId, series.seriesId).catch(() => null);
  const groups = remaining(selectableGroups(chapters, manifest?.chapters));
  await enqueueChapters(series, toEnqueue(groups, getPreferredGroup()));
  return groups.length;
}

/** A direct series' one page set is already kept or queued. */
function directSettled(manifest: DownloadedChapter[] | null | undefined): boolean {
  return (manifest ?? []).some((c) => c.chapterId === DIRECT_DOWNLOAD_CHAPTER_ID && settled(c.state));
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

/** Which library entries a backfill covers: every bridge that auto-downloads series when the
 *  Settings → General toggle goes on, or one bridge asked for by name — an explicit request, so
 *  the global toggle and the bridge's own opt-out don't apply. */
function backfills(bridgeId: string | undefined): (entry: ApiCollectedSeries) => boolean {
  return (entry) => (bridgeId ? entry.bridgeId === bridgeId : autoDownloadsFor(entry.bridgeId, 'autoSeries'));
}

/** The library entries a backfill walks, with each one's installed bridge. */
async function backfillEntries(include: (entry: ApiCollectedSeries) => boolean) {
  const [library, bridges] = await Promise.all([getLibrary(), getBridges()]);
  const installed = new Map(bridges.map((b) => [b.id, b]));
  return (library ?? []).flatMap((entry) => {
    const bridge = installed.get(entry.bridgeId);
    return bridge && include(entry) ? [{ entry, direct: bridge.capabilities.includes('direct') }] : [];
  });
}

type BackfillEntry = Awaited<ReturnType<typeof backfillEntries>>[number];

/** `fn` over every item, at most `limit` in flight — a few hundred stored reads without queueing
 *  them all at once behind the transport. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** The offer `autoDownloadLibrary` makes before it runs. */
export interface LibraryBackfill {
  /** Series the run would enqueue something for. */
  series: number;
  /** About how many chapters those add up to. */
  chapters: number;
  /** Series already fully kept or queued, which the run leaves alone. */
  skipped: number;
}

/**
 * What `autoDownloadLibrary` would take on, judged per series the way the run judges it: the stored
 * chapter list against the download manifest. Every manifest comes from one storage-usage read and
 * each stored list is a local read, so a large library costs no bridge call. A series never synced
 * has no stored list — the run asks its bridge — so it counts as a download by its known total.
 */
export async function librarySize(bridgeId?: string): Promise<LibraryBackfill> {
  return sizeOf(await backfillEntries(backfills(bridgeId)));
}

async function sizeOf(entries: BackfillEntry[]): Promise<LibraryBackfill> {
  const usage = await dlStorageUsage().catch(() => null);
  const manifests = new Map((usage?.bySeries ?? []).map((s) => [`${s.bridgeId}\u0000${s.seriesId}`, s.chapters]));
  const size: LibraryBackfill = { series: 0, chapters: 0, skipped: 0 };
  await eachLimited(entries, 8, async ({ entry, direct }) => {
    const manifest = manifests.get(`${entry.bridgeId}\u0000${entry.seriesId}`);
    let pending: number;
    if (direct) {
      pending = directSettled(manifest) ? 0 : 1;
    } else {
      const chapters = await savedChapters(entry.bridgeId, entry.seriesId).catch(() => []);
      if (chapters.length === 0) {
        size.series += 1;
        size.chapters += entry.knownCount;
        return;
      }
      pending = remaining(selectableGroups(chapters, manifest)).length;
    }
    if (pending > 0) {
      size.series += 1;
      size.chapters += pending;
    } else {
      size.skipped += 1;
    }
  });
  return size;
}

/** The offer's sentence: what a run would download, and what it would leave alone. `where` says
 *  whose series these are, e.g. "from this bridge". */
export function describeBackfill({ series, chapters, skipped }: LibraryBackfill, where: string): string {
  const skip =
    skipped === 0 ? '' : ` ${skipped} already downloaded ${skipped === 1 ? 'is' : 'are'} skipped.`;
  return `${series} series ${where} will be downloaded, about ${chapters} chapter${chapters === 1 ? '' : 's'}.${skip}`;
}

/**
 * Download every series already in the library, one at a time. Each reads the stored chapter list
 * and only asks the bridge for a series that has none (never synced), so a large library costs a
 * stored read per series rather than a bridge request. Series whose bridge isn't installed, or has
 * opted out of series downloads, are skipped — unless `bridgeId` names one bridge, which takes
 * only its series and ignores the opt-out. Resolves with how many series it enqueued something for;
 * one already fully kept or queued doesn't count.
 */
export async function autoDownloadLibrary(ds: DataSource, mock: boolean, bridgeId?: string): Promise<number> {
  if (mock) return 0;
  return downloadEntries(ds, await backfillEntries(backfills(bridgeId)));
}

async function downloadEntries(ds: DataSource, entries: BackfillEntry[]): Promise<number> {
  let count = 0;
  for (const { entry, direct } of entries) {
    const series = withCover(false, {
      bridgeId: entry.bridgeId,
      seriesId: entry.seriesId,
      title: entry.seriesTitle,
      ...(entry.thumbnailUrl !== undefined && { thumbnailUrl: entry.thumbnailUrl }),
      ...(entry.author !== undefined && { author: entry.author }),
    });
    try {
      if (direct) {
        const manifest = await dlGetSeries(series.bridgeId, series.seriesId).catch(() => null);
        if (directSettled(manifest?.chapters)) continue;
        await enqueueChapter({ ...series, chapterId: DIRECT_DOWNLOAD_CHAPTER_ID, direct: true });
        count += 1;
      } else {
        let chapters = await savedChapters(series.bridgeId, series.seriesId).catch(() => []);
        if (chapters.length === 0) {
          const q = seriesListQuery(ds, false, series.bridgeId, series.seriesId, false, true);
          chapters = (await queryClient.fetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn })).chapters ?? [];
        }
        if ((await enqueueRemaining(series, chapters)) > 0) count += 1;
      }
    } catch (e) {
      report(e, `library bridge=${series.bridgeId} series=${series.seriesId}`);
    }
  }
  return count;
}

/** What `syncedSeriesBackfill` would take on, and the run that does it. */
export interface SyncedBackfill {
  size: LibraryBackfill;
  download(ds: DataSource): Promise<number>;
}

/**
 * Series another device's sync just put in this library, judged by THIS device's series toggle and
 * bridge opt-outs — the save that would have downloaded them ran on the other device, against its
 * own. Null when none of them would download here. The caller decides whether to ask first.
 */
export async function syncedSeriesBackfill(
  added: readonly { bridgeId: string; seriesId: string }[],
): Promise<SyncedBackfill | null> {
  // Called as a sync lands, which can be at launch, before the prefs have hydrated (read off).
  await Promise.all([whenPersistLoaded(downloadPrefs$), whenPersistLoaded(bridgeAutoDownload$)]);
  if (added.length === 0 || !getDownloadPrefsSync().autoSeries) return null;
  const keys = new Set(added.map((s) => JSON.stringify([s.bridgeId, s.seriesId])));
  const entries = await backfillEntries(
    (e) => keys.has(JSON.stringify([e.bridgeId, e.seriesId])) && autoDownloadsFor(e.bridgeId, 'autoSeries'),
  );
  if (entries.length === 0) return null;
  const size = await sizeOf(entries);
  return size.series === 0 ? null : { size, download: (ds) => downloadEntries(ds, entries) };
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
  await Promise.all([
    whenPersistLoaded(downloadPrefs$),
    whenPersistLoaded(newChaptersSince$),
    whenPersistLoaded(bridgeAutoDownload$),
  ]);
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
    if (a.read || !autoDownloadsFor(a.bridgeId, 'autoNew')) continue;
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
  if (mock || !autoDownloadsFor(ref.bridgeId, 'autoChapters')) return;
  void enqueueChapter(withCover(mock, ref));
}

/** A page was just saved. A direct series' pages are filed under the reserved direct chapter id. */
export function autoDownloadPage(
  mock: boolean,
  ref: SeriesRef & { chapterId: string; pageIndex: number; chapterName?: string },
): void {
  if (mock || !autoDownloadsFor(ref.bridgeId, 'autoPages')) return;
  const { pageIndex, ...rest } = withCover(mock, ref);
  void enqueueChapter({ ...rest, direct: ref.chapterId === DIRECT_DOWNLOAD_CHAPTER_ID, onlyPages: [pageIndex] });
}
