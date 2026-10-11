/**
 * The words around a library backup: its file name, what a picked file holds, and what a restore
 * did. Free of react-native imports so it can be tested.
 */
import { LibraryBackupError, parseEntryKey, readLibraryBackup, type LibraryBackup } from '@comical/library';

import type { LibraryRestoreResult } from './api';

const NOT_A_BACKUP = "This isn't a Comical library backup.";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pad = (n: number) => String(n).padStart(2, '0');

export function backupFileName(exportedAt: number): string {
  const d = new Date(exportedAt);
  return `comical-library-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/**
 * Reads a picked file far enough to describe it before anything is changed. `raw` is what gets
 * sent to be restored — the host reads it again itself, and counts what it leaves out.
 * Throws an `Error` whose message is written for the user.
 */
export function parseBackupFile(text: string): { raw: unknown; backup: LibraryBackup } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  try {
    return { raw, backup: readLibraryBackup(raw).backup };
  } catch (err) {
    throw new Error(err instanceof LibraryBackupError ? err.message : NOT_A_BACKUP);
  }
}

export function describeBackup(backup: LibraryBackup): string {
  const series = backup.items.filter((item) => item.type === 'series').length;
  const saved = new Date(backup.exportedAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  return [
    `Saved ${saved}`,
    `${plural(series, 'series', 'series')} in ${plural(backup.collections.length, 'collection')}`,
    `reading progress for ${plural(Object.keys(backup.progress).length, 'series', 'series')}`,
  ].join(' · ');
}

export interface MissingFromBackup {
  bridges: string[];
  trackers: string[];
}

/**
 * The bridges and trackers a backup's records belong to that aren't installed here. Read off the
 * records, not the file's `sources` note: what matters is what the restored library will need, and
 * a file is free to say anything about where it came from. `trackers: null` is a host that has no
 * trackers at all — nothing to install there, so nothing is reported.
 */
export function missingFromBackup(
  backup: LibraryBackup,
  installed: { bridges: string[]; trackers: string[] | null },
): MissingFromBackup {
  const bridges = new Set<string>();
  for (const item of backup.items) bridges.add(item.bridgeId);
  for (const row of backup.readingLog) bridges.add(row.bridgeId);
  for (const key of Object.keys(backup.progress)) bridges.add(parseEntryKey(key).bridgeId);
  const trackers = new Set(Object.values(backup.trackerLinks).flatMap((links) => links.map((link) => link.trackerId)));

  const lacking = (needed: Set<string>, have: string[]) => {
    const here = new Set(have);
    return [...needed].filter((id) => !here.has(id)).sort();
  };
  return {
    bridges: lacking(bridges, installed.bridges),
    trackers: installed.trackers ? lacking(trackers, installed.trackers) : [],
  };
}

const NAMED = 6;
const named = (ids: string[]) =>
  ids.length > NAMED ? `${ids.slice(0, NAMED).join(', ')} and ${ids.length - NAMED} more` : ids.join(', ');

/** What to say before restoring a backup whose bridges or trackers aren't all here; `null` when
 *  they are. Names the registries the missing ones came from, where the backup noted them. */
export function describeMissing(backup: LibraryBackup, missing: MissingFromBackup): string | null {
  const kinds = [
    missing.bridges.length > 0 && `${plural(missing.bridges.length, 'bridge')} (${named(missing.bridges)})`,
    missing.trackers.length > 0 && `${plural(missing.trackers.length, 'tracker')} (${named(missing.trackers)})`,
  ].filter(Boolean);
  if (kinds.length === 0) return null;

  const lacking = new Set([...missing.bridges, ...missing.trackers]);
  const noted = [...(backup.sources?.bridges ?? []), ...(backup.sources?.trackers ?? [])];
  const from = [...new Set(noted.filter((source) => lacking.has(source.id)).map((source) => source.registryUrl))];
  const one = lacking.size === 1;
  return [
    `Needs ${kinds.join(' and ')} that ${one ? "isn't" : "aren't"} installed here.`,
    `${one ? 'Its' : 'Their'} part of the library is restored, but won't work until ${one ? 'it is' : 'they are'}.`,
    from.length > 0 && `Find ${one ? 'it' : 'them'} at ${from.join(', ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function describeRestore({ restored, skipped }: LibraryRestoreResult): string {
  const other = restored.collections + restored.groups + restored.trackerLinks + restored.readingLog + restored.bridgePrefs;
  const wrote = [
    restored.items > 0 && plural(restored.items, 'library item'),
    restored.progress > 0 && `progress on ${plural(restored.progress, 'chapter')}`,
    // Absent from hosts older than chapter lists in backups.
    (restored.chapters ?? 0) > 0 && plural(restored.chapters ?? 0, 'chapter list'),
    other > 0 && plural(other, 'other record'),
  ].filter(Boolean);
  const head = wrote.length > 0 ? `Restored ${wrote.join(', ')}` : 'Nothing to restore — your library already has everything in this backup';
  return skipped > 0 ? `${head} · ${plural(skipped, 'unreadable record')} left out` : head;
}
