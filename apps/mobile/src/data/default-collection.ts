import { persisted$ } from '@/lib/observable';
import type { Collection } from './types';

/**
 * The collection an unfiled collect goes into — the plain "＋ Library" tap, and a bulk import of a
 * bridge's favorites, neither of which has a collection to name.
 *
 * It is an ORDINARY collection: renameable, reorderable, deletable like any other. What it is NOT
 * is identified by its name. The default used to be `collections.find(c => c.name === 'Library')`,
 * which had two visible faults: renaming it in Manage collections silently spawned a second one on
 * the next add, and a collection literally called "Library" sat in the Library tab's selector right
 * under the row for the whole library — two rows, same word, and (for a freshly migrated shelf)
 * the same contents. So the id is remembered on the device and the name is just a name.
 */
export const DEFAULT_COLLECTION = 'Default';

/** What the first cut of the library migration named it. Adopted once, then forgotten — see below. */
const LEGACY_DEFAULT_COLLECTION = 'Library';

/** Wrapped in an object because a persisted *primitive* observable reads back as `{}` before
 *  anything is stored, whereas an object initial round-trips cleanly (see `data/api.ts`). */
const defaultCollection$ = persisted$<{ id: string | null }>('comical:defaultCollection', { id: null });

/** Remember which collection is the default. Called by the resolver, and by the library migration
 *  with the collection it filed a rebuilt shelf into. */
export function setDefaultCollectionId(id: string): void {
  defaultCollection$.set({ id });
}

/** The device seams `resolveDefaultCollection` needs. Injected rather than imported so the rule has
 *  one implementation whether it runs against the real API or the mock. */
export type DefaultCollectionOps = {
  list: (signal?: AbortSignal) => Promise<Collection[]>;
  create: (name: string, signal?: AbortSignal) => Promise<Collection>;
  rename: (id: string, name: string, signal?: AbortSignal) => Promise<void>;
};

/**
 * The default collection's id, resolving in this order and remembering the answer:
 *
 * 1. **The remembered id**, if it still resolves — the steady state, and what makes renaming it
 *    harmless.
 * 2. **A collection already named `Default`** — a fresh install, or a device whose stored id was
 *    cleared.
 * 3. **A collection named `Library`**, renamed in place. That is what the first cut of the library
 *    migration created, so this adopts an already-migrated shelf instead of leaving it stranded
 *    beside a new `Default`. It can only fire on the first resolve on a device (no stored id, no
 *    `Default`), so a collection the user named "Library" themselves is renamed at most once — the
 *    cost of not duplicating a migrated library, which is the far more likely case.
 * 4. Otherwise **create it**.
 */
export async function resolveDefaultCollection(ops: DefaultCollectionOps, signal?: AbortSignal): Promise<string> {
  const collections = await ops.list(signal);

  const rememberedId = defaultCollection$.peek().id;
  if (rememberedId && collections.some((c) => c.id === rememberedId)) return rememberedId;

  const adopt = (c: Collection) => {
    setDefaultCollectionId(c.id);
    return c.id;
  };

  const named = collections.find((c) => c.name === DEFAULT_COLLECTION);
  if (named) return adopt(named);

  const legacy = collections.find((c) => c.name === LEGACY_DEFAULT_COLLECTION);
  if (legacy) {
    await ops.rename(legacy.id, DEFAULT_COLLECTION, signal);
    return adopt(legacy);
  }

  return adopt(await ops.create(DEFAULT_COLLECTION, signal));
}
