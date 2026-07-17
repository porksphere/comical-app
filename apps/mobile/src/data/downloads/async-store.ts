/**
 * AsyncStorage-backed `DownloadsStore` — the on-device analog of the server's file-backed
 * `FileDownloadsStore` (`@comical/host-server`). The `Downloads` domain service holds all logic; a
 * store is just a typed document sink, so this mirrors the file store's layout with one AsyncStorage
 * key per "file". Pages live under their own per-chapter key (not inside the chapter) because they are
 * the bulk of a download — recording one page's bytes must not rewrite the whole list:
 *
 *   comical:dl:series               → { [entryKey]: DownloadedSeries }
 *   comical:dl:prefs                → DownloadPrefs
 *   comical:dl:chapters:<key>       → { [chapterId]: DownloadedChapter }
 *   comical:dl:pages:<key>:<chId>   → { [index]: DownloadedPage }
 *
 * This persists only the MANIFEST — the image bytes live on the filesystem (`blob-store.ts`). Injected
 * into `@comical/host-rn` via `startup.ts` so the embedded router mounts `/downloads*`.
 *
 * Every operation is SERIALIZED through one promise queue: each doc is an async read-modify-write,
 * and the embedded router runs requests concurrently — a bulk series download fires many enqueues at
 * once, and two interleaved `putChapter`s on the same doc meant last-writer-wins, silently dropping
 * a chapter record (surfacing later as "chapter not downloaded"). The queue is the transaction.
 *
 * Docs are also CACHED in memory with write-through (mirroring the server's `FileDownloadsStore`):
 * without it, every op re-read and re-JSON.parsed the whole growing doc — a 300-chapter bulk enqueue
 * was O(n²) parse work through the queue, which is what made big series crawl and stall. Reads hit
 * the cache after first touch; writes update the cache and persist. Because of the cache, everything
 * must share ONE instance — use the exported `downloadsStore` singleton, never `new` a second copy
 * (its cache would go stale the moment the other instance writes).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type DownloadPrefs,
  type DownloadedChapter,
  type DownloadedPage,
  type DownloadedSeries,
  type DownloadsStore,
} from '@comical/downloads';

const NS = 'comical:dl';
const SERIES = `${NS}:series`;
const PREFS = `${NS}:prefs`;
const chaptersKey = (key: string) => `${NS}:chapters:${encodeURIComponent(key)}`;
const pagesKey = (key: string, chapterId: string) => `${NS}:pages:${encodeURIComponent(key)}:${encodeURIComponent(chapterId)}`;

async function read<T>(storageKey: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function write(storageKey: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(value));
}

/** A record-backed store (one JSON object per key). */
async function readRecord<T>(storageKey: string): Promise<Record<string, T>> {
  return read<Record<string, T>>(storageKey, {});
}

export class AsyncStorageDownloadsStore implements DownloadsStore {
  // The serialization queue (see the module docstring): every op — reads included, so a read never
  // observes a half-applied batch of writes it interleaved with — runs strictly after the previous one.
  private queue: Promise<unknown> = Promise.resolve();
  private run<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => {});
    return next;
  }

  // ── In-memory doc caches (write-through; loaded lazily inside the queue) ─────
  private docs = new Map<string, Record<string, unknown>>();
  private async doc<T>(storageKey: string): Promise<Record<string, T>> {
    let cached = this.docs.get(storageKey);
    if (!cached) {
      cached = await readRecord<T>(storageKey);
      this.docs.set(storageKey, cached);
    }
    return cached as Record<string, T>;
  }
  private async flush(storageKey: string): Promise<void> {
    await write(storageKey, this.docs.get(storageKey) ?? {});
  }
  private async removeDoc(storageKey: string): Promise<void> {
    this.docs.set(storageKey, {});
    await AsyncStorage.removeItem(storageKey);
  }

  // ── Series ─────────────────────────────────────────────────────────────────
  listSeries(): Promise<DownloadedSeries[]> {
    return this.run(async () => Object.values(await this.doc<DownloadedSeries>(SERIES)));
  }
  getSeries(key: string): Promise<DownloadedSeries | undefined> {
    return this.run(async () => (await this.doc<DownloadedSeries>(SERIES))[key]);
  }
  putSeries(series: DownloadedSeries): Promise<void> {
    return this.run(async () => {
      const all = await this.doc<DownloadedSeries>(SERIES);
      all[`${series.bridgeId}:${series.seriesId}`] = series;
      await this.flush(SERIES);
    });
  }
  deleteSeries(key: string): Promise<void> {
    return this.run(async () => {
      const all = await this.doc<DownloadedSeries>(SERIES);
      if (key in all) {
        delete all[key];
        await this.flush(SERIES);
      }
    });
  }

  // ── Chapters ───────────────────────────────────────────────────────────────
  listChapters(key: string): Promise<DownloadedChapter[]> {
    return this.run(async () => Object.values(await this.doc<DownloadedChapter>(chaptersKey(key))));
  }
  getChapter(key: string, chapterId: string): Promise<DownloadedChapter | undefined> {
    return this.run(async () => (await this.doc<DownloadedChapter>(chaptersKey(key)))[chapterId]);
  }
  putChapter(chapter: DownloadedChapter): Promise<void> {
    return this.run(async () => {
      const key = `${chapter.bridgeId}:${chapter.seriesId}`;
      const all = await this.doc<DownloadedChapter>(chaptersKey(key));
      all[chapter.chapterId] = chapter;
      await this.flush(chaptersKey(key));
    });
  }
  deleteChapter(key: string, chapterId: string): Promise<void> {
    return this.run(async () => {
      const all = await this.doc<DownloadedChapter>(chaptersKey(key));
      if (chapterId in all) {
        delete all[chapterId];
        await this.flush(chaptersKey(key));
      }
    });
  }
  deleteChaptersForEntry(key: string): Promise<void> {
    return this.run(async () => this.removeDoc(chaptersKey(key)));
  }

  // ── Pages ──────────────────────────────────────────────────────────────────
  listPages(key: string, chapterId: string): Promise<DownloadedPage[]> {
    return this.run(async () => {
      const all = await this.doc<DownloadedPage>(pagesKey(key, chapterId));
      return Object.values(all).sort((a, b) => a.index - b.index);
    });
  }
  putPage(key: string, chapterId: string, page: DownloadedPage): Promise<void> {
    return this.run(async () => {
      const all = await this.doc<DownloadedPage>(pagesKey(key, chapterId));
      all[String(page.index)] = page;
      await this.flush(pagesKey(key, chapterId));
    });
  }
  deletePagesForChapter(key: string, chapterId: string): Promise<void> {
    return this.run(async () => this.removeDoc(pagesKey(key, chapterId)));
  }

  // ── Preferences ────────────────────────────────────────────────────────────
  getPrefs(): Promise<DownloadPrefs | undefined> {
    return this.run(async () => {
      const raw = await AsyncStorage.getItem(PREFS);
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw) as DownloadPrefs;
      } catch {
        return undefined;
      }
    });
  }
  setPrefs(prefs: DownloadPrefs): Promise<void> {
    return this.run(async () => write(PREFS, prefs));
  }
}

/**
 * The one shared instance — the in-memory cache makes a second instance incoherent (it would keep
 * serving its own stale snapshot after this one writes). Both the embedded runtime's store and the
 * offline index read through this.
 */
export const downloadsStore = new AsyncStorageDownloadsStore();
