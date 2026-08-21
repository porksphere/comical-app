import type { Collection } from './types';

/**
 * Where a BULK, non-interactive collect files things — today, importing a bridge's favorites.
 *
 * Interactive saves don't use this: a tap files into the collection that type was last filed into,
 * and asks when there isn't one (`data/last-collection.ts`, the Google Maps model). That rule needs
 * a user to fall back on, and an import of eighty series has none — so it needs a named destination
 * that exists without asking.
 *
 * The name is deliberately the one `Library.importLegacyEntries` files a migrated shelf into, so an
 * import lands in the collection the user's library is already in rather than a second one beside
 * it. It is an ORDINARY collection either way: renameable, reorderable, deletable like any other.
 * Renaming it means the next bulk import lazily creates a fresh one — mildly surprising, and better
 * than a collection the UI won't let you touch.
 */
export const DEFAULT_COLLECTION = 'Library';

/** Its id, creating it on first use. Takes its two calls as parameters rather than importing a
 *  data source, so any caller shares one implementation of the lazily-created-by-name rule. */
export async function resolveDefaultCollection(
  list: (signal?: AbortSignal) => Promise<Collection[]>,
  create: (name: string, signal?: AbortSignal) => Promise<Collection>,
  signal?: AbortSignal,
): Promise<string> {
  const existing = (await list(signal)).find((c) => c.name === DEFAULT_COLLECTION);
  return existing ? existing.id : (await create(DEFAULT_COLLECTION, signal)).id;
}
