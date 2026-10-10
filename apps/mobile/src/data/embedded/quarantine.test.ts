/**
 * Unreadable stored bytes are moved aside, never read as "empty" and then written over: the stores
 * that use this all write back the whole document they read.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mem = new Map<string, string>();
const logged: string[] = [];

const storage = {
  getItem: async (k: string) => mem.get(k) ?? null,
  setItem: async (k: string, v: string) => {
    mem.set(k, v);
  },
  removeItem: async (k: string) => {
    mem.delete(k);
  },
  getAllKeys: async () => [...mem.keys()],
  multiGet: async (keys: string[]) => keys.map((k) => [k, mem.get(k) ?? null]),
};
mock.module('@react-native-async-storage/async-storage', () => ({ default: storage }));
mock.module('@/lib/diagnostics', () => ({ logDiagnostic: (_c: string, m: string) => logged.push(m) }));

const { parseStored } = await import('./quarantine');
const { AsyncStorageLibraryStore } = await import('./library-store');
const { asyncStorageSettings } = await import('./settings-store');
const { AsyncStorageDownloadsStore } = await import('../downloads/async-store');

const parked = (key: string) =>
  [...mem].filter(([k]) => k.startsWith(`comical:corrupt:${key}:`)).map(([, v]) => v);

beforeEach(() => {
  mem.clear();
  logged.length = 0;
});

describe('parseStored', () => {
  test('a value of the expected kind is returned as is', async () => {
    mem.set('k', '[1,2]');
    expect(await parseStored('k', '[1,2]', [] as number[])).toEqual([1, 2]);
    expect(await parseStored('k', '{"a":1}', {})).toEqual({ a: 1 });
    expect(await parseStored('k', '{"a":1}', undefined)).toEqual({ a: 1 });
    expect(mem.get('k')).toBe('[1,2]');
    expect(logged).toEqual([]);
  });

  test('unparseable bytes are moved aside and logged, and the fallback returned', async () => {
    mem.set('k', '{"trunc');
    expect(await parseStored('k', '{"trunc', [] as string[])).toEqual([]);
    expect(mem.has('k')).toBe(false);
    expect(parked('k')).toEqual(['{"trunc']);
    expect(logged).toHaveLength(1);
  });

  test('valid JSON of the wrong kind is quarantined too', async () => {
    for (const [raw, fallback] of [
      ['null', {}],
      ['"text"', {}],
      ['[1]', {}],
      ['{"a":1}', []],
      ['7', undefined],
    ] as const) {
      mem.clear();
      mem.set('k', raw);
      expect(await parseStored('k', raw, fallback)).toBe(fallback);
      expect(parked('k')).toEqual([raw]);
    }
  });

  test('a value rewritten since it was read is left alone', async () => {
    mem.set('k', '[]');
    await parseStored('k', 'garbage', []);
    expect(mem.get('k')).toBe('[]');
    expect(parked('k')).toEqual(['garbage']);
  });
});

describe('stores keep what they cannot read', () => {
  test('library: a corrupt collections doc is parked, and the next write starts clean', async () => {
    mem.set('comical:lib:collections', '[{"id":"c1"');
    const store = new AsyncStorageLibraryStore();
    expect(await store.listCollections()).toEqual([]);
    await store.updateCollections(() => [{ id: 'c2', name: 'New', createdAt: 1, updatedAt: 1 } as never]);
    expect(parked('comical:lib:collections')).toEqual(['[{"id":"c1"']);
  });

  test('library: a corrupt item shard is parked and never listed back in', async () => {
    const good = 'comical:lib:collection-items:b:s1';
    const bad = 'comical:lib:collection-items:b:s2';
    const item = { id: 'x', type: 'series', bridgeId: 'b', seriesId: 's1' };
    mem.set(good, JSON.stringify({ x: item }));
    mem.set(bad, 'not json');
    const store = new AsyncStorageLibraryStore();
    expect(await store.listCollectionItems()).toEqual([item as never]);
    expect(parked(bad)).toEqual(['not json']);
    expect(await store.listCollectionItems()).toEqual([item as never]);
    expect(logged).toHaveLength(1);
  });

  test('settings: a corrupt blob reads as unset and is parked', async () => {
    mem.set('comical:embedded:settings:demo', '{oops');
    expect(await asyncStorageSettings.get('demo')).toEqual({});
    expect(parked('comical:embedded:settings:demo')).toEqual(['{oops']);
  });

  test('downloads: corrupt series and prefs docs are parked', async () => {
    mem.set('comical:dl:series', '{"b:s":');
    mem.set('comical:dl:prefs', '[]');
    const store = new AsyncStorageDownloadsStore();
    expect(await store.listSeries()).toEqual([]);
    expect(await store.getPrefs()).toBeUndefined();
    expect(parked('comical:dl:series')).toEqual(['{"b:s":']);
    expect(parked('comical:dl:prefs')).toEqual(['[]']);
  });
});
