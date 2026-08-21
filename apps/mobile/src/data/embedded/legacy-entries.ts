/**
 * One-shot migration of this device's pre-collections entries document.
 *
 * The library dissolved into collections: a tracked series is now a `CollectionSeriesItem` in the
 * per-series shards, and `comical:lib:entries` is dead. It is also the ONLY casualty — everything a
 * series owns (read progress, tracker links, the cached detail and chapter list, group membership)
 * is keyed by `entryKey` in its own document, so the dissolution orphaned those rather than
 * deleting them. Rebuild the series items and the lot reattaches: shelf, unread counts, resume
 * points, tracker links.
 *
 * Which is why this exists in a project that otherwise does no data migration. The no-back-compat
 * rule was written for lists and page favorites, which shipped to nobody. The library is the user's
 * actual collection, built up over months; skipping this would open the app to an empty shelf.
 *
 * The domain logic lives in `Library.importLegacyEntries` so every host migrates identically (the
 * server does the same thing to its `entries.json` — see `host-server/src/legacy-entries.ts`). This
 * module's whole job is to find the device's own legacy document and hand the rows over.
 *
 * Delete it once the migration has run everywhere.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Library, type LibraryStore } from '@comical/library';

/** The pre-collections document: `{ [entryKey]: LibraryEntry }`. Not a `library-store.ts` constant
 *  any more — that store no longer has an entries concept, and this is the only reader left. */
const ENTRIES = 'comical:lib:entries';
/** Where the original is parked afterwards. Kept, not deleted: this import is the only thing
 *  standing between the user and a lost library, so the source survives until they've seen it
 *  work. It stays inside `comical:lib:*`, so it does show up in the Storage screen's library
 *  figure — honest, since it's real bytes, and it's the nudge to eventually drop it. */
const MIGRATED = 'comical:lib:entries.migrated';

export type LegacyEntriesMigration = { imported: number; skipped: number };

/**
 * Import the legacy entries document if it's still there, then park it under `MIGRATED`.
 *
 * Returns `undefined` when there was nothing to do, which is the steady state — every launch after
 * the first. Safe to run unconditionally: `importLegacyEntries` skips coordinates that are already
 * collected, so a re-run after a crash can't clobber anything written since.
 *
 * Requires `installWebCryptoShim()` to have run — the import mints a collection id with
 * `crypto.randomUUID`, which Hermes doesn't ship.
 */
export async function migrateLegacyEntries(store: LibraryStore): Promise<LegacyEntriesMigration | undefined> {
  const raw = await AsyncStorage.getItem(ENTRIES);
  if (raw == null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unreadable. Leave it exactly where it is rather than parking the evidence away — there is
    // nothing to gain by hiding it, and a future version may be able to salvage more.
    return undefined;
  }
  const rows = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>);
  if (rows.length === 0) return undefined;

  // Rows are validated individually inside; a half-corrupt document yields the entries it can.
  const { imported, skipped } = await new Library(store).importLegacyEntries(rows);
  await AsyncStorage.setItem(MIGRATED, raw);
  await AsyncStorage.removeItem(ENTRIES);
  return { imported, skipped };
}
