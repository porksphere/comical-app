import type { Collection } from './types';

/**
 * The collection "add to library" files into.
 *
 * The library dissolved into collections: being in the library IS being a series item in at least
 * one collection, so the plain add-to-library button has to name one. This is that name — and it is
 * deliberately the same name the legacy-entries migration files an imported shelf into
 * (`Library.importLegacyEntries`'s default), so a migrated user's adds land in the collection their
 * whole library is already in rather than in a second one beside it.
 *
 * It is an ORDINARY collection, not a privileged one: the user can rename, reorder or delete it
 * like any other. Renaming it just means the next plain add lazily creates a fresh "Library" —
 * mildly surprising, but the alternative (a collection the UI won't let you touch) is worse, and it
 * matches how the reader's one-tap save treats its own destination.
 */
export const DEFAULT_COLLECTION = 'Library';

/**
 * The default collection's id, creating it on first use.
 *
 * Takes its two calls as parameters rather than importing a data source, so the real and mock
 * sources share one implementation of the lazily-created-by-name rule — the thing worth having in
 * exactly one place.
 */
export async function resolveDefaultCollection(
  list: (signal?: AbortSignal) => Promise<Collection[]>,
  create: (name: string, signal?: AbortSignal) => Promise<Collection>,
  signal?: AbortSignal,
): Promise<string> {
  const existing = (await list(signal)).find((c) => c.name === DEFAULT_COLLECTION);
  return existing ? existing.id : (await create(DEFAULT_COLLECTION, signal)).id;
}
