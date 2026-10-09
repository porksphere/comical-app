/**
 * The tracker-import screen's bookkeeping, kept free of React so it can be unit-tested: which rows
 * the list shows and in what order, what each row says it will do, and what the confirmed selection
 * turns into for the host.
 *
 * The host classifies every tracker entry against the library (`TrackerImportCandidate.match`); the
 * screen adds one more fact per `none` entry — whether a bridge search has found it (`Resolution`)
 * — and the two together decide the row's kind:
 *   - `in-library`  — held here but not linked to this tracker. Importing links it; the library's own
 *                     progress is never touched (it's pushed to the tracker if it's further ahead).
 *   - `resolved`    — not held; a bridge search found it (or the user picked a candidate). Importing
 *                     collects it, links it, and — new series only — may seed its read progress.
 *   - `unresolved`  — not held and not yet found. Not selectable; "Find on…" or a candidate pick
 *                     turns it into `resolved`.
 *   - `linked`      — already linked to this tracker. Inert.
 */
import type {
  ApiSeriesEntry,
  TrackerImportCandidate,
  TrackerImportItem,
  TrackerImportResolveResult,
  TrackerImportResult,
  TrackerStatus,
} from '@/data/api';

/** The list key: tracker ids come back as a number from some trackers and a string from others. */
export const rowKey = (externalId: string | number): string => String(externalId);

/** One bridge search's answer for a `none` entry, plus the user's pick when there were several. */
export interface Resolution {
  bridgeId: string;
  exact?: ApiSeriesEntry;
  candidates: ApiSeriesEntry[];
  error?: string;
  chosen?: ApiSeriesEntry;
}

export type ImportRowKind = 'in-library' | 'resolved' | 'unresolved' | 'linked';

export interface ImportRow {
  key: string;
  item: TrackerImportCandidate;
  kind: ImportRowKind;
  resolution?: Resolution;
  /** The bridge series a `resolved` row imports as — the user's pick over the search's exact hit. */
  target?: { bridgeId: string; series: ApiSeriesEntry };
}

export const isSelectableKind = (kind: ImportRowKind) => kind === 'in-library' || kind === 'resolved';

/** The resolution's effective target, if it has one. */
function targetOf(res: Resolution | undefined): ApiSeriesEntry | undefined {
  return res?.chosen ?? res?.exact;
}

/**
 * Rows in list order: actionable first (library matches and resolved finds, in tracker order), then
 * the still-unresolved, then the already-linked. The order is load-bearing, not cosmetic — the
 * selectable keys must be the list's leading indices for the check-rail drag sweep's index math.
 */
export function planRows(items: readonly TrackerImportCandidate[], resolutions: ReadonlyMap<string, Resolution>): ImportRow[] {
  const actionable: ImportRow[] = [];
  const unresolved: ImportRow[] = [];
  const linked: ImportRow[] = [];
  for (const item of items) {
    const key = rowKey(item.externalId);
    if (item.match === 'linked') {
      linked.push({ key, item, kind: 'linked' });
    } else if (item.match === 'in-library') {
      actionable.push({ key, item, kind: 'in-library' });
    } else {
      const resolution = resolutions.get(key);
      const series = targetOf(resolution);
      if (resolution && series) {
        actionable.push({ key, item, kind: 'resolved', resolution, target: { bridgeId: resolution.bridgeId, series } });
      } else {
        unresolved.push({ key, item, kind: 'unresolved', ...(resolution && { resolution }) });
      }
    }
  }
  return [...actionable, ...unresolved, ...linked];
}

export const selectableKeys = (rows: readonly ImportRow[]) => rows.filter((r) => isSelectableKind(r.kind)).map((r) => r.key);

/** Selectable rows the tracker says are being read right now. */
export const readingKeys = (rows: readonly ImportRow[]) =>
  rows
    .filter((r) => isSelectableKind(r.kind) && (r.item.status === 'reading' || r.item.status === 'rereading'))
    .map((r) => r.key);

/** Entries a bridge search still has to find — every `unresolved` row, including ones another bridge missed. */
export const unresolvedEntries = (rows: readonly ImportRow[]) =>
  rows
    .filter((r) => r.kind === 'unresolved')
    .map((r) => ({
      externalId: r.item.externalId,
      title: r.item.title,
      ...(r.item.altTitles && r.item.altTitles.length > 0 && { altTitles: r.item.altTitles }),
    }));

/** Fold one bridge's search answers into the resolution map. A later search for the same entry
 *  replaces the earlier miss; a user's pick survives only while the entry stays on the same bridge. */
export function mergeResolutions(
  prev: ReadonlyMap<string, Resolution>,
  bridgeId: string,
  results: readonly TrackerImportResolveResult[],
): Map<string, Resolution> {
  const next = new Map(prev);
  for (const r of results) {
    const key = rowKey(r.externalId);
    const old = prev.get(key);
    next.set(key, {
      bridgeId,
      candidates: r.candidates,
      ...(r.exact && { exact: r.exact }),
      ...(r.error && { error: r.error }),
      ...(old?.chosen && old.bridgeId === bridgeId && { chosen: old.chosen }),
    });
  }
  return next;
}

const STATUS_LABEL: Record<TrackerStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  'on-hold': 'On hold',
  dropped: 'Dropped',
  planning: 'Planning',
  rereading: 'Rereading',
};

/** "Ch. 20/40", "Ch. 20", or the status when the tracker holds no chapter count (planning). */
export function progressLabel(item: Pick<TrackerImportCandidate, 'status' | 'chaptersRead' | 'totalChapters'>): string {
  if (item.chaptersRead === undefined) return STATUS_LABEL[item.status];
  return item.totalChapters !== undefined ? `Ch. ${item.chaptersRead}/${item.totalChapters}` : `Ch. ${item.chaptersRead}`;
}

/** The library's furthest copy — several copies (cross-bridge) each get linked, and the furthest is
 *  what decides whether the tracker is updated. */
export const localReadOf = (item: TrackerImportCandidate) => Math.max(0, ...(item.entries ?? []).map((e) => e.localRead));

/**
 * The one-line outcome under the title: what importing this row will DO, not just what it is, so
 * the user can read the plan off the list before confirming it.
 */
/** One line under the row's title saying what importing it DOES — outcome first, since a settings
 *  row shows a single line and a phone fits about forty characters of it after the cover. */
export function rowDescription(row: ImportRow, opts: { seed: boolean; nameOf: (bridgeId: string) => string }): string {
  const { item } = row;
  switch (row.kind) {
    case 'linked':
      return 'Already linked';
    case 'in-library': {
      const local = localReadOf(item);
      const remote = item.chaptersRead ?? 0;
      if (local > remote) return `Links · pushes ${local} read to tracker`;
      if (local > 0) return `Links · read ${local} here, ${remote} on tracker`;
      return remote > 0 ? `Links · ${remote} read on tracker` : 'Links';
    }
    case 'resolved': {
      const target = row.target!;
      const seeds = opts.seed && (item.chaptersRead ?? 0) > 0 ? ` · marks ${item.chaptersRead} read` : '';
      // The matched title is only worth the room when it isn't the tracker's own.
      const as = sameTitle(target.series.title, item.title) ? '' : ` “${target.series.title}”`;
      return `Adds${as} from ${opts.nameOf(target.bridgeId)}${seeds}`;
    }
    case 'unresolved': {
      const res = row.resolution;
      if (!res) return `${progressLabel(item)} · Not in library`;
      const bridge = opts.nameOf(res.bridgeId);
      if (res.error) return `Couldn't search ${bridge}`;
      if (res.candidates.length > 0) {
        return `Tap to pick from ${res.candidates.length} on ${bridge}`;
      }
      return `Not found on ${bridge}`;
    }
  }
}

function sameTitle(a: string, b: string): boolean {
  const fold = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return fold(a) === fold(b);
}

/** The host's items for the checked rows: one per library copy for a held series, the chosen bridge
 *  series for a found one. */
export function itemsForImport(rows: readonly ImportRow[], selected: ReadonlySet<string>): TrackerImportItem[] {
  const out: TrackerImportItem[] = [];
  for (const row of rows) {
    if (!selected.has(row.key)) continue;
    const { item } = row;
    const base = {
      externalId: item.externalId,
      title: item.title,
      status: item.status,
      ...(item.chaptersRead !== undefined && { chaptersRead: item.chaptersRead }),
      ...(item.totalChapters !== undefined && { totalChapters: item.totalChapters }),
    };
    if (row.kind === 'in-library') {
      for (const e of item.entries ?? []) {
        out.push({
          ...base,
          ...(item.thumbnailUrl !== undefined && { thumbnailUrl: item.thumbnailUrl }),
          bridgeId: e.bridgeId,
          seriesId: e.seriesId,
        });
      }
    } else if (row.kind === 'resolved' && row.target) {
      const cover = row.target.series.thumbnailUrl ?? item.thumbnailUrl;
      out.push({
        ...base,
        ...(cover !== undefined && { thumbnailUrl: cover }),
        bridgeId: row.target.bridgeId,
        seriesId: row.target.series.id,
      });
    }
  }
  return out;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const emptyImportResult = (): TrackerImportResult => ({ imported: 0, linked: 0, seeded: 0, pushed: 0, failed: [] });

/** Sum the per-batch results into one. */
export function sumImportResults(results: readonly TrackerImportResult[]): TrackerImportResult {
  const total = emptyImportResult();
  for (const r of results) {
    total.imported += r.imported;
    total.linked += r.linked;
    total.seeded += r.seeded;
    total.pushed += r.pushed;
    total.failed.push(...r.failed);
  }
  return total;
}

/** The toast after an import — the counts that changed something, nothing else. */
export function importSummary(result: TrackerImportResult): string {
  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported} added`);
  // `linked` counts every link made, the ones on freshly added series included; only the links on
  // series the library already held are news here.
  const held = Math.max(0, result.linked - result.imported);
  if (held > 0) parts.push(`${held} linked`);
  if (result.pushed > 0) parts.push(`${result.pushed} updated on tracker`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
  return parts.length > 0 ? parts.join(' · ') : 'Nothing to import';
}
