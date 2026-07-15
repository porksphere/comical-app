/**
 * The "library" arm: the same three tables in a TinyBase MergeableStore. MergeableStore gives us,
 * for free: HLC stamps, LWW-per-cell merge, row-level tombstones, and `store.merge(other)` two-way
 * offline convergence — plus (not exercised here) persisters for RN/web/Node and a WebSocket
 * synchronizer. That is almost the entire transport/plumbing layer the design would otherwise build.
 *
 * The catch this arm exists to expose: MergeableStore merges every cell by LWW. Read progress needs
 * a MONOTONIC merge, which LWW cannot express — see run.ts.
 */
import { createMergeableStore, type MergeableStore } from 'tinybase';
import type { ChapterProgress, LibraryEntry, Registry } from './model';

const pk = (entryKey: string, chapterId: string) => `${entryKey}::${chapterId}`;

export class TinybaseStore {
  private store: MergeableStore;
  constructor(node: string) {
    this.store = createMergeableStore(node);
  }

  putEntry(e: LibraryEntry): void {
    this.store.setRow('entries', e.key, { title: e.title, favorite: e.favorite });
  }
  removeEntry(key: string): void {
    this.store.delRow('entries', key); // MergeableStore keeps an HLC tombstone
  }
  addRegistry(r: Registry): void {
    this.store.setRow('registries', r.url, { name: r.name });
  }
  removeRegistry(url: string): void {
    this.store.delRow('registries', url);
  }
  putProgress(entryKey: string, row: ChapterProgress): void {
    // Naive LWW modelling: page/completed are plain cells. This is precisely what breaks.
    this.store.setRow('progress', pk(entryKey, row.chapterId), {
      entryKey,
      chapterId: row.chapterId,
      chapterNumber: row.chapterNumber,
      page: row.page,
      pageCount: row.pageCount,
      completed: row.completed,
    });
  }

  liveEntries(): LibraryEntry[] {
    const t = this.store.getTable('entries');
    return Object.entries(t).map(([key, c]) => ({ key, title: String(c.title), favorite: Boolean(c.favorite) }));
  }
  liveRegistries(): string[] {
    return Object.keys(this.store.getTable('registries')).sort();
  }
  progressRows(entryKey: string): ChapterProgress[] {
    return Object.values(this.store.getTable('progress'))
      .filter((c) => c.entryKey === entryKey)
      .map((c) => ({
        chapterId: String(c.chapterId),
        chapterNumber: Number(c.chapterNumber),
        page: Number(c.page),
        pageCount: Number(c.pageCount),
        completed: Boolean(c.completed),
      }));
  }

  /** Two-way offline merge — both stores end up converged. */
  merge(other: TinybaseStore): void {
    this.store.merge(other.store);
  }
}
