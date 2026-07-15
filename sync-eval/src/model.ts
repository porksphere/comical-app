/**
 * Three representative slices of the real LibraryStore (apps/mobile/src/data/embedded/library-store.ts),
 * chosen because between them they exercise all three merge primitives the design calls for:
 *
 *   - entries      → LWW register + tombstone   (library membership)
 *   - registries   → set add/remove             (OR-set / LWW-element-set)
 *   - progress     → MONOTONIC max merge         (read position — must never roll back)
 *
 * If a sync approach handles these three correctly it handles the rest of the store, which is just
 * more LWW registers and more sets.
 */

/** comical:lib:entries — keyed `${bridgeId}:${seriesId}`. */
export type LibraryEntry = {
  key: string;
  title: string;
  favorite: boolean;
};

/** comical:embedded:registries — a set of registry URLs the user added. */
export type Registry = { url: string; name: string };

/**
 * comical:lib:progress:<entry> — one row per chapter. `page` and `completed` are monotonic:
 * furthest-read wins. `chapterNumber` mirrors the reader's chapter-order source of truth, used to
 * derive a series' resume point.
 */
export type ChapterProgress = {
  chapterId: string;
  chapterNumber: number;
  page: number;
  pageCount: number;
  completed: boolean;
};

/** The furthest chapter (by chapter-order) that has any progress — the series "resume here". */
export function resumePoint(rows: ChapterProgress[]): ChapterProgress | undefined {
  return rows.reduce<ChapterProgress | undefined>((best, r) => {
    if (!best) return r;
    if (r.chapterNumber > best.chapterNumber) return r;
    if (r.chapterNumber === best.chapterNumber && r.page > best.page) return r;
    return best;
  }, undefined);
}
