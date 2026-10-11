import { describe, expect, test } from 'bun:test';
import { entryKey, InMemoryLibraryStore, Library } from '@comical/library';

import {
  backupFileName,
  describeBackup,
  describeMissing,
  describeRestore,
  missingFromBackup,
  parseBackupFile,
} from './backup-summary';

const NONE = { collections: 0, items: 0, progress: 0, groups: 0, trackerLinks: 0, readingLog: 0, bridgePrefs: 0, chapters: 0 };

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
    expect(describeRestore({ restored, skipped: 0 })).toBe(
      'Restored 12 library items, progress on 1 chapter, 5 other records',
    );
  });

  test('names restored chapter lists, and tolerates a host that predates them', () => {
    expect(describeRestore({ restored: { ...NONE, items: 1, chapters: 3 }, skipped: 0 })).toBe(
      'Restored 1 library item, 3 chapter lists',
    );
    const { chapters: _, ...old } = { ...NONE, items: 1 };
    expect(describeRestore({ restored: old as unknown as typeof NONE, skipped: 0 })).toBe('Restored 1 library item');
  });

  test('says when the library already had it all', () => {
    expect(describeRestore({ restored: NONE, skipped: 0 })).toMatch(/^Nothing to restore/);
  });

  test('mentions records left out', () => {
    expect(describeRestore({ restored: { ...NONE, items: 1 }, skipped: 2 })).toBe(
      'Restored 1 library item · 2 unreadable records left out',
    );
  });
});

describe('missingFromBackup', () => {
  /** Collected on `demo`, only read on `passing-by`, in history on `logged`, linked to `anilist`. */
  async function mixed() {
    const library = new Library(new InMemoryLibraryStore());
    await library.collectSeries({ bridgeId: 'demo', seriesId: 'kept' }, { seriesTitle: 'Kept' });
    await library.setProgress(entryKey('passing-by', 'read'), 'c1', 1, 10);
    await library.recordRead({ bridgeId: 'logged', seriesId: 'seen', title: 'Seen', lastReadAt: 5 });
    await library.linkTracker(entryKey('demo', 'kept'), 'anilist', 1);
    return library.exportBackup();
  }

  test('finds every bridge and tracker the records need, however they need it', async () => {
    expect(missingFromBackup(await mixed(), { bridges: [], trackers: [] })).toEqual({
      bridges: ['demo', 'logged', 'passing-by'],
      trackers: ['anilist'],
    });
  });

  test('leaves out what is installed', async () => {
    const installed = { bridges: ['demo', 'logged', 'passing-by', 'unrelated'], trackers: ['anilist'] };
    expect(missingFromBackup(await mixed(), installed)).toEqual({ bridges: [], trackers: [] });
  });

  test('reports no tracker on a host that has none to install', async () => {
    expect(missingFromBackup(await mixed(), { bridges: ['demo'], trackers: null })).toEqual({
      bridges: ['logged', 'passing-by'],
      trackers: [],
    });
  });

  test('goes by the records, not by what the file says it came from', async () => {
    const claimed = { registries: [], bridges: [{ id: 'claimed', registryUrl: 'https://r.example/index.json' }], trackers: [] };
    const backup = { ...(await mixed()), sources: claimed };
    expect(missingFromBackup(backup, { bridges: ['demo', 'logged', 'passing-by'], trackers: ['anilist'] }).bridges).toEqual([]);
  });
});

describe('describeMissing', () => {
  const backup = async (bridges?: { id: string; registryUrl: string }[]) => ({
    ...(await exported()),
    ...(bridges && { sources: { registries: [], bridges, trackers: [] } }),
  });

  test('is silent when nothing is missing', async () => {
    expect(describeMissing(await backup(), { bridges: [], trackers: [] })).toBeNull();
  });

  test('names what is missing', async () => {
    expect(describeMissing(await backup(), { bridges: ['alpha', 'beta'], trackers: ['anilist'] })).toBe(
      "Needs 2 bridges (alpha, beta) and 1 tracker (anilist) that aren't installed here. " +
        "Their part of the library is restored, but won't work until they are.",
    );
  });

  test('speaks of one when one is missing', async () => {
    expect(describeMissing(await backup(), { bridges: [], trackers: ['anilist'] })).toBe(
      "Needs 1 tracker (anilist) that isn't installed here. Its part of the library is restored, but won't work until it is.",
    );
  });

  test('says where the missing ones came from, and only those', async () => {
    const sources = [
      { id: 'alpha', registryUrl: 'https://one.example/index.json' },
      { id: 'installed', registryUrl: 'https://two.example/index.json' },
    ];
    expect(describeMissing(await backup(sources), { bridges: ['alpha'], trackers: [] })).toEndWith(
      'Find it at https://one.example/index.json.',
    );
  });

  test('stops naming after a handful', async () => {
    const bridges = Array.from({ length: 9 }, (_, i) => `b${i}`);
    expect(describeMissing(await backup(), { bridges, trackers: [] })).toContain('(b0, b1, b2, b3, b4, b5 and 3 more)');
  });
});
