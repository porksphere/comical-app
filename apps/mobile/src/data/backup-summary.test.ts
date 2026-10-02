import { describe, expect, test } from 'bun:test';
import { entryKey, InMemoryLibraryStore, Library } from '@comical/library';

import { backupFileName, describeBackup, describeRestore, parseBackupFile } from './backup-summary';

const NONE = { collections: 0, items: 0, progress: 0, groups: 0, trackerLinks: 0, readingLog: 0, bridgePrefs: 0 };

async function exported() {
  const library = new Library(new InMemoryLibraryStore());
  const shelf = await library.createCollection('Reading');
  await library.collectSeries({ bridgeId: 'demo', seriesId: 'kept' }, { seriesTitle: 'Kept', collectionIds: [shelf.id] });
  await library.setProgress(entryKey('demo', 'kept'), 'c1', 3, 10);
  await library.setProgress(entryKey('demo', 'passing'), 'p1', 1, 10);
  return library.exportBackup();
}

describe('backupFileName', () => {
  test('is dated by the local day the backup was made', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 30).getTime())).toBe('comical-library-2026-01-05.json');
  });
});

describe('parseBackupFile', () => {
  test('reads an exported library, and hands back the document as it was', async () => {
    const backup = await exported();
    const text = JSON.stringify({ ...backup, items: [...backup.items, { id: 'damaged' }] });

    const picked = parseBackupFile(text);

    expect(picked.raw).toEqual(JSON.parse(text));
    expect(picked.backup.items.map((i) => i.id)).toEqual(['series:demo:kept']);
  });

  test('says so in plain words when the file is not a backup', () => {
    for (const text of ['', '{', '<html>', '[]', '{"format":"other"}']) {
      expect(() => parseBackupFile(text)).toThrow("This isn't a Comical library backup.");
    }
  });

  test('says to update when the backup is from a newer build', async () => {
    const text = JSON.stringify({ ...(await exported()), version: 99 });
    expect(() => parseBackupFile(text)).toThrow(/newer version of Comical/);
  });
});

describe('describeBackup', () => {
  test('counts series, collections, and every series with read state', async () => {
    const line = describeBackup(await exported());
    expect(line).toContain('1 series in 1 collection');
    expect(line).toContain('reading progress for 2 series');
  });
});

describe('describeRestore', () => {
  test('leads with what was written', () => {
    const restored = { ...NONE, items: 12, progress: 1, collections: 2, readingLog: 3 };
    expect(describeRestore({ restored, skipped: 0, failed: [] })).toBe(
      'Restored 12 library items, progress on 1 chapter, 5 other records',
    );
  });

  test('says when the library already had it all', () => {
    expect(describeRestore({ restored: NONE, skipped: 0, failed: [] })).toMatch(/^Nothing to restore/);
  });

  test('mentions sources that failed and records left out', () => {
    const failed = [{ kind: 'bridge' as const, id: 'gone', error: 'not in registry' }];
    expect(describeRestore({ restored: { ...NONE, items: 1 }, skipped: 2, failed })).toBe(
      "Restored 1 library item · 1 source couldn't be brought back · 2 unreadable records left out",
    );
  });
});
