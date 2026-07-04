/**
 * AsyncStorage-backed `LibraryStore` — the on-device analog of the server's file-backed
 * `FileLibraryStore` (`@comical/host-server`). The `Library` domain service holds all logic; a store
 * is just a typed document sink, so this mirrors the file store's layout with one AsyncStorage key
 * per "file":
 *
 *   comical:lib:entries            → { [entryKey]: LibraryEntry }
 *   comical:lib:lists              → LibraryList[]
 *   comical:lib:groups             → { [id]: SeriesGroup }
 *   comical:lib:tracker-links      → { [entryKey]: TrackerLink[] }
 *   comical:lib:reading-log        → { [entryKey]: HistoryItem }
 *   comical:lib:bridge-prefs       → { [bridgeId]: BridgePrefs }
 *   comical:lib:activity           → { [activityKey]: ActivityItem }
 *   comical:lib:progress:<key>     → { [chapterId]: ChapterProgress }
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
  type ChapterProgress,
  type HistoryItem,
  type LibraryEntry,
  type LibraryList,
  type LibraryStore,
  type SeriesGroup,
  type TrackerLink,
} from '@comical/library';

const NS = 'comical:lib';
const ENTRIES = `${NS}:entries`;
const LISTS = `${NS}:lists`;
const GROUPS = `${NS}:groups`;
const TRACKER_LINKS = `${NS}:tracker-links`;
const READING_LOG = `${NS}:reading-log`;
const BRIDGE_PREFS = `${NS}:bridge-prefs`;
const ACTIVITY = `${NS}:activity`;
const progressKey = (key: string) => `${NS}:progress:${encodeURIComponent(key)}`;

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

export class AsyncStorageLibraryStore implements LibraryStore {
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

  // ── Lists ──────────────────────────────────────────────────────────────────
  async listLists(): Promise<LibraryList[]> {
    return read<LibraryList[]>(LISTS, []);
  }
  async putList(list: LibraryList): Promise<void> {
    const lists = await read<LibraryList[]>(LISTS, []);
    const idx = lists.findIndex((l) => l.id === list.id);
    if (idx === -1) lists.push(list);
    else lists[idx] = list;
    await write(LISTS, lists);
  }
  async deleteList(id: string): Promise<void> {
    const lists = await read<LibraryList[]>(LISTS, []);
    await write(LISTS, lists.filter((l) => l.id !== id));
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
