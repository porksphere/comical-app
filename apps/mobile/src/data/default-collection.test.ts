/**
 * `resolveDefaultCollection` — where an unfiled collect lands.
 *
 * Worth pinning because it runs against collections a user already has, and the two ways it can be
 * wrong are both silent: adopt nothing and you get a second default beside the one holding their
 * whole migrated library; adopt too eagerly and you rename a collection they made themselves.
 */
import { beforeEach, describe, expect, test } from 'bun:test';

import { DEFAULT_COLLECTION, resolveDefaultCollection } from './default-collection';

// The device's remembered id — injected, which is the whole reason this module keeps the persisted
// store at arm's length (see `default-collection-store.ts`). No platform mocks needed.
let stored: { id: string | null } = { id: null };

type Row = { id: string; name: string; order: number };

function ops(initial: Row[]) {
  const rows = [...initial];
  const renames: [string, string][] = [];
  const creates: string[] = [];
  return {
    rows,
    renames,
    creates,
    list: async () => rows,
    create: async (name: string) => {
      creates.push(name);
      const row = { id: `new-${creates.length}`, name, order: rows.length };
      rows.push(row);
      return row;
    },
    rename: async (id: string, name: string) => {
      renames.push([id, name]);
      const row = rows.find((r) => r.id === id);
      if (row) row.name = name;
    },
    storedId: () => stored.id,
    remember: (id: string) => {
      stored = { id };
    },
  };
}

describe('resolveDefaultCollection', () => {
  beforeEach(() => {
    stored = { id: null };
  });

  test('creates one when the device has nothing', async () => {
    const o = ops([]);
    expect(await resolveDefaultCollection(o)).toBe('new-1');
    expect(o.creates).toEqual([DEFAULT_COLLECTION]);
    expect(stored.id).toBe('new-1');
  });

  test('remembers it, so a second call neither searches nor creates', async () => {
    const o = ops([]);
    const first = await resolveDefaultCollection(o);
    expect(await resolveDefaultCollection(o)).toBe(first);
    expect(o.creates).toHaveLength(1);
  });

  test('follows a rename instead of spawning a second default', async () => {
    // The whole reason the id is stored rather than the name: this is an ordinary collection and
    // the user may rename it in Manage collections.
    const o = ops([]);
    const id = await resolveDefaultCollection(o);
    o.rows[0]!.name = 'Reading';
    expect(await resolveDefaultCollection(o)).toBe(id);
    expect(o.creates).toHaveLength(1);
  });

  test('adopts a migrated shelf, renaming it in place', async () => {
    // What the first cut of the library migration left behind: a collection named "Library"
    // holding the user's entire imported library. Creating a fresh "Default" beside it is the
    // duplicate-row bug this exists to prevent.
    const o = ops([{ id: 'lib', name: 'Library', order: 0 }]);
    expect(await resolveDefaultCollection(o)).toBe('lib');
    expect(o.renames).toEqual([['lib', DEFAULT_COLLECTION]]);
    expect(o.creates).toEqual([]);
  });

  test('prefers an existing Default over the legacy name', async () => {
    const o = ops([
      { id: 'lib', name: 'Library', order: 0 },
      { id: 'def', name: DEFAULT_COLLECTION, order: 1 },
    ]);
    expect(await resolveDefaultCollection(o)).toBe('def');
    expect(o.renames).toEqual([]);
  });

  test('re-resolves when the remembered collection has been deleted', async () => {
    stored = { id: 'gone' };
    const o = ops([{ id: 'def', name: DEFAULT_COLLECTION, order: 0 }]);
    expect(await resolveDefaultCollection(o)).toBe('def');
    expect(stored.id).toBe('def');
  });

  test('leaves other collections alone', async () => {
    const o = ops([{ id: 'r', name: 'Reading', order: 0 }]);
    await resolveDefaultCollection(o);
    expect(o.renames).toEqual([]);
    expect(o.rows.find((r) => r.id === 'r')?.name).toBe('Reading');
  });
});
