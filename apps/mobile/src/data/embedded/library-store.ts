/**
 * AsyncStorage-backed `LibraryStore` — the on-device analog of the server's file-backed
 * `FileLibraryStore` (`@comical/host-server`). The `Library` domain service holds all logic; a store
 * is just a typed document sink, so this mirrors the file store's layout with one AsyncStorage key
 * per "file":
 *
 *   comical:lib:entries            → { [entryKey]: LibraryEntry }
 *   comical:lib:collections               → Collection[]
 *   comical:lib:collection-items:<b>:<s>  → { [id]: CollectionItem }   (SHARDED per series)
 *   comical:lib:groups             → { [id]: SeriesGroup }
 *   comical:lib:tracker-links      → { [entryKey]: TrackerLink[] }
 *   comical:lib:reading-log        → { [entryKey]: HistoryItem }
 *   comical:lib:bridge-prefs       → { [bridgeId]: BridgePrefs }
 *   comical:lib:activity           → { [activityKey]: ActivityItem }
 *   comical:lib:progress:<key>     → { [chapterId]: ChapterProgress }
 *   comical:lib:detail:<key>       → CachedSeriesDetail   (offline series page)
 *   comical:lib:chapters:<key>     → CachedChapters       (offline chapter list)
 *
 * Single-user, local scale: read/parse/write per operation (no in-memory cache), which keeps it
 * trivially correct — the library is small and writes are infrequent (a read or an add/remove).
 * Injected into `@comical/host-rn` via `startup.ts` so the embedded router mounts `/library*`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  activityKey,
  type ActivityItem,
  type BridgePrefs,
  type CachedChapters,
  type CachedSeriesDetail,
  type ChapterProgress,
  type HistoryItem,
  type Collection,
  type CollectionItem,
  type CollectionItemScope,
  type LibraryEntry,
  type LibraryStore,
  parseCollectionItemId,
  type SeriesGroup,
  type TrackerLink,
} from '@comical/library';

import { serializeAsyncMethods } from '@/lib/serialize-methods';

const NS = 'comical:lib';
const ENTRIES = `${NS}:entries`;
const COLLECTIONS = `${NS}:collections`;
// Collection items sit in ONE DOCUMENT PER SERIES, not one document overall. As a single doc every
// write re-serialises every item the user has: the runtime measured 64ms → 3.4ms per chapter open
// at 25k items. A series item lives in its own series' shard, so one layout covers all three types,
// and every coordinate carries bridge+series so an id always resolves to a shard.
const collectionItemsKey = (bridgeId: string, seriesId: string) =>
  `${NS}:collection-items:${encodeURIComponent(bridgeId)}:${encodeURIComponent(seriesId)}`;
const COLLECTION_ITEMS_PREFIX = `${NS}:collection-items:`;
const GROUPS = `${NS}:groups`;
const TRACKER_LINKS = `${NS}:tracker-links`;
const READING_LOG = `${NS}:reading-log`;
const BRIDGE_PREFS = `${NS}:bridge-prefs`;
const ACTIVITY = `${NS}:activity`;
const progressKey = (key: string) => `${NS}:progress:${encodeURIComponent(key)}`;
const detailKey = (key: string) => `${NS}:detail:${encodeURIComponent(key)}`;
const cachedChaptersKey = (key: string) => `${NS}:chapters:${encodeURIComponent(key)}`;

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

/** UTF-8 byte length; Hermes builds without TextEncoder fall back to the (close) UTF-16 length. */
function byteLength(s: string): number {
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length;
  }
}

export class AsyncStorageLibraryStore implements LibraryStore {
  constructor() {
    // Every method is an async read-modify-write on a shared doc, and the router's write-throughs
    // (detail cache + snapshot reconcile + chapter sync) run concurrently — serialize, or two
    // interleaved writers silently drop records (see serialize-methods.ts / the downloads store).
    serializeAsyncMethods(this);
  }

  // ── Disk usage ──────────────────────────────────────────────────────────────
  /** Bytes this store's documents occupy in AsyncStorage (all `comical:lib:*` keys). Cover blobs
   *  live in the covers BlobStore and report separately (see /library/usage). */
  async diskUsage(): Promise<number> {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${NS}:`));
      if (keys.length === 0) return 0;
      const pairs = await AsyncStorage.multiGet(keys);
      let total = 0;
      for (const [k, v] of pairs) total += byteLength(k) + (v ? byteLength(v) : 0);
      return total;
    } catch {
      return 0;
    }
  }

  // ── Entries ────────────────────────────────────────────────────────────────
  async listEntries(): Promise<LibraryEntry[]> {
    return Object.values(await readRecord<LibraryEntry>(ENTRIES));
  }
  async getEntry(key: string): Promise<LibraryEntry | undefined> {
    return (await readRecord<LibraryEntry>(ENTRIES))[key];
  }
  async putEntry(entry: LibraryEntry): Promise<void> {
    const all = await readRecord<LibraryEntry>(ENTRIES);
    all[`${entry.bridgeId}:${entry.seriesId}`] = entry;
    await write(ENTRIES, all);
  }
  async deleteEntry(key: string): Promise<void> {
    const all = await readRecord<LibraryEntry>(ENTRIES);
    if (key in all) {
      delete all[key];
      await write(ENTRIES, all);
    }
  }

  // ── Offline metadata cache ───────────────────────────────────────────────────
  // One doc per entry (chapter lists are bulky), read lazily on series-page open — never bulk-read.
  async getSeriesDetail(key: string): Promise<CachedSeriesDetail | undefined> {
    return read<CachedSeriesDetail | undefined>(detailKey(key), undefined);
  }
  async putSeriesDetail(key: string, detail: CachedSeriesDetail): Promise<void> {
    await write(detailKey(key), detail);
  }
  async deleteSeriesDetail(key: string): Promise<void> {
    await AsyncStorage.removeItem(detailKey(key));
  }
  async getCachedChapters(key: string): Promise<CachedChapters | undefined> {
    return read<CachedChapters | undefined>(cachedChaptersKey(key), undefined);
  }
  async putCachedChapters(key: string, doc: CachedChapters): Promise<void> {
    await write(cachedChaptersKey(key), doc);
  }
  async deleteCachedChapters(key: string): Promise<void> {
    await AsyncStorage.removeItem(cachedChaptersKey(key));
  }

  // ── Progress ───────────────────────────────────────────────────────────────
  async listProgress(key: string): Promise<ChapterProgress[]> {
    return Object.values(await readRecord<ChapterProgress>(progressKey(key)));
  }
  async putProgress(key: string, progress: ChapterProgress): Promise<void> {
    const all = await readRecord<ChapterProgress>(progressKey(key));
    all[progress.chapterId] = progress;
    await write(progressKey(key), all);
  }
  async deleteProgressForEntry(key: string): Promise<void> {
    await AsyncStorage.removeItem(progressKey(key));
  }

  // ── Collection items ───────────────────────────────────────────────────────
  // Collections replaced the library's custom lists, and an item exists ONLY as a member of one —
  // there is no local "favorites" concept, and nothing is durably uncollected. Old
  // `comical:lib:lists` documents and any `listIds` left on stored entries are ABANDONED IN PLACE —
  // never read, never migrated (a deliberate call; see docs/collections-client-plan.md). Inert.

  /** Honours `scope` BEFORE parsing where it can: a series-scoped call reads one shard instead of
   *  every one, which is what keeps opening a chapter off the whole-library path. */
  async listCollectionItems(scope?: CollectionItemScope): Promise<CollectionItem[]> {
    const keys =
      scope?.bridgeId !== undefined && scope?.seriesId !== undefined
        ? [collectionItemsKey(scope.bridgeId, scope.seriesId)]
        : (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(COLLECTION_ITEMS_PREFIX));
    if (keys.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(keys);
    const out: CollectionItem[] = [];
    for (const [, raw] of pairs) {
      if (!raw) continue;
      let shard: Record<string, CollectionItem>;
      try {
        shard = JSON.parse(raw) as Record<string, CollectionItem>;
      } catch {
        continue;
      }
      for (const item of Object.values(shard)) {
        if (scope?.type !== undefined && item.type !== scope.type) continue;
        if (scope?.bridgeId !== undefined && item.bridgeId !== scope.bridgeId) continue;
        if (scope?.seriesId !== undefined && item.seriesId !== scope.seriesId) continue;
        // A series item has NO chapterId, so a chapter-scoped listing must drop it outright rather
        // than compare an absent field — matching both reference stores.
        if (scope?.chapterId !== undefined && (item.type === 'series' || item.chapterId !== scope.chapterId)) {
          continue;
        }
        out.push(item);
      }
    }
    return out;
  }

  async getCollectionItem(id: string): Promise<CollectionItem | undefined> {
    const coord = parseCollectionItemId(id);
    if (!coord) return undefined;
    const shard = await readRecord<CollectionItem>(collectionItemsKey(coord.bridgeId, coord.seriesId));
    return shard[id];
  }

  /** ONE durable write per shard touched, however many records the batch carries — a chapter
   *  reconcile repairs its whole chapter through a single call. */
  async putCollectionItems(items: CollectionItem[]): Promise<void> {
    if (items.length === 0) return;
    const byShard = new Map<string, CollectionItem[]>();
    for (const item of items) {
      const key = collectionItemsKey(item.bridgeId, item.seriesId);
      const bucket = byShard.get(key);
      if (bucket) bucket.push(item);
      else byShard.set(key, [item]);
    }
    for (const [key, shardItems] of byShard) {
      const shard = await readRecord<CollectionItem>(key);
      for (const item of shardItems) shard[item.id] = item;
      await write(key, shard);
    }
  }

  async deleteCollectionItems(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const byShard = new Map<string, string[]>();
    for (const id of ids) {
      const coord = parseCollectionItemId(id);
      if (!coord) continue;
      const key = collectionItemsKey(coord.bridgeId, coord.seriesId);
      const bucket = byShard.get(key);
      if (bucket) bucket.push(id);
      else byShard.set(key, [id]);
    }
    for (const [key, shardIds] of byShard) {
      const shard = await readRecord<CollectionItem>(key);
      let touched = false;
      for (const id of shardIds) {
        if (id in shard) {
          delete shard[id];
          touched = true;
        }
      }
      if (!touched) continue;
      // Drop an emptied shard rather than leaving `{}` behind, so `getAllKeys` doesn't accumulate
      // dead keys that every unscoped listing then has to read.
      if (Object.keys(shard).length === 0) await AsyncStorage.removeItem(key);
      else await write(key, shard);
    }
  }

  // Collections stay a SINGLE document — there are few of them and they're read as a whole.
  async listCollections(): Promise<Collection[]> {
    return read<Collection[]>(COLLECTIONS, []);
  }
  async putCollections(collections: Collection[]): Promise<void> {
    await write(COLLECTIONS, collections);
  }

  // ── Groups ─────────────────────────────────────────────────────────────────
  async listGroups(): Promise<SeriesGroup[]> {
    return Object.values(await readRecord<SeriesGroup>(GROUPS));
  }
  async putGroup(group: SeriesGroup): Promise<void> {
    const all = await readRecord<SeriesGroup>(GROUPS);
    all[group.id] = group;
    await write(GROUPS, all);
  }
  async deleteGroup(id: string): Promise<void> {
    const all = await readRecord<SeriesGroup>(GROUPS);
    if (id in all) {
      delete all[id];
      await write(GROUPS, all);
    }
  }

  // ── Tracker links ────────────────────────────────────────────────────────────
  async listTrackerLinks(key: string): Promise<TrackerLink[]> {
    return (await readRecord<TrackerLink[]>(TRACKER_LINKS))[key] ?? [];
  }
  async putTrackerLink(key: string, link: TrackerLink): Promise<void> {
    const all = await readRecord<TrackerLink[]>(TRACKER_LINKS);
    const existing = all[key] ?? [];
    const idx = existing.findIndex((l) => l.trackerId === link.trackerId);
    if (idx === -1) existing.push(link);
    else existing[idx] = link;
    all[key] = existing;
    await write(TRACKER_LINKS, all);
  }
  async deleteTrackerLink(key: string, trackerId: string): Promise<void> {
    const all = await readRecord<TrackerLink[]>(TRACKER_LINKS);
    const existing = all[key];
    if (!existing) return;
    const next = existing.filter((l) => l.trackerId !== trackerId);
    if (next.length === existing.length) return;
    if (next.length === 0) delete all[key];
    else all[key] = next;
    await write(TRACKER_LINKS, all);
  }

  // ── Reading log ──────────────────────────────────────────────────────────────
  async listReadingLog(): Promise<HistoryItem[]> {
    return Object.values(await readRecord<HistoryItem>(READING_LOG));
  }
  async upsertReadingLog(item: HistoryItem): Promise<void> {
    const all = await readRecord<HistoryItem>(READING_LOG);
    all[`${item.bridgeId}:${item.seriesId}`] = item;
    await write(READING_LOG, all);
  }
  async deleteReadingLog(bridgeId: string, seriesId: string): Promise<void> {
    const all = await readRecord<HistoryItem>(READING_LOG);
    const k = `${bridgeId}:${seriesId}`;
    if (k in all) {
      delete all[k];
      await write(READING_LOG, all);
    }
  }

  // ── Bridge preferences ───────────────────────────────────────────────────────
  async getBridgePrefs(bridgeId: string): Promise<BridgePrefs | undefined> {
    return (await readRecord<BridgePrefs>(BRIDGE_PREFS))[bridgeId];
  }
  async setBridgePrefs(bridgeId: string, prefs: BridgePrefs): Promise<void> {
    const all = await readRecord<BridgePrefs>(BRIDGE_PREFS);
    all[bridgeId] = prefs;
    await write(BRIDGE_PREFS, all);
  }

  // ── Activity feed ────────────────────────────────────────────────────────────
  async listActivity(): Promise<ActivityItem[]> {
    return Object.values(await readRecord<ActivityItem>(ACTIVITY));
  }
  async putActivity(item: ActivityItem): Promise<void> {
    const all = await readRecord<ActivityItem>(ACTIVITY);
    all[activityKey(item.bridgeId, item.seriesId, item.chapterId)] = item;
    await write(ACTIVITY, all);
  }
  async deleteActivityForEntry(key: string): Promise<void> {
    const all = await readRecord<ActivityItem>(ACTIVITY);
    const prefix = `${key}:`;
    let changed = false;
    for (const k of Object.keys(all)) {
      if (k.startsWith(prefix)) {
        delete all[k];
        changed = true;
      }
    }
    if (changed) await write(ACTIVITY, all);
  }
  async clearActivity(): Promise<void> {
    await AsyncStorage.removeItem(ACTIVITY);
  }
}
