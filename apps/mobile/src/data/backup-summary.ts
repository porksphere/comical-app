/**
 * The words around a library backup: its file name, what a picked file holds, and what a restore
 * did. Free of react-native imports so it can be tested.
 */
import { LibraryBackupError, readLibraryBackup, type LibraryBackup } from '@comical/library';

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

export function describeRestore({ restored, skipped, failed }: LibraryRestoreResult): string {
  const other = restored.collections + restored.groups + restored.trackerLinks + restored.readingLog + restored.bridgePrefs;
  const wrote = [
    restored.items > 0 && plural(restored.items, 'library item'),
    restored.progress > 0 && `progress on ${plural(restored.progress, 'chapter')}`,
    other > 0 && plural(other, 'other record'),
  ].filter(Boolean);
  const notes = [
    failed.length > 0 && `${plural(failed.length, 'source')} couldn't be brought back`,
    skipped > 0 && `${plural(skipped, 'unreadable record')} left out`,
  ].filter(Boolean);
  const head = wrote.length > 0 ? `Restored ${wrote.join(', ')}` : 'Nothing to restore — your library already has everything in this backup';
  return [head, ...notes].join(' · ');
}
