import { describe, expect, test } from 'bun:test';

import type { TrackerImportCandidate } from '@/data/api';

import {
  chunk,
  importSummary,
  itemsForImport,
  mergeResolutions,
  planRows,
  progressLabel,
  readingKeys,
  rowDescription,
  selectableKeys,
  sumImportResults,
  unresolvedEntries,
  type Resolution,
} from './tracker-import';

const nameOf = (id: string) => `Bridge ${id}`;

const held: TrackerImportCandidate = {
  externalId: 1,
  title: 'Held',
  status: 'reading',
  chaptersRead: 20,
  totalChapters: 40,
  match: 'in-library',
  entries: [
    { key: 'a:held', bridgeId: 'a', seriesId: 'held', title: 'Held', localRead: 12 },
    { key: 'b:held', bridgeId: 'b', seriesId: 'held-b', title: 'Held', localRead: 30 },
  ],
};
const missing: TrackerImportCandidate = { externalId: '2', title: 'Missing', altTitles: ['Alt'], status: 'completed', chaptersRead: 10, totalChapters: 10, match: 'none' };
const planned: TrackerImportCandidate = { externalId: 3, title: 'Planned', status: 'planning', match: 'none' };
const linked: TrackerImportCandidate = { externalId: 4, title: 'Linked', status: 'rereading', chaptersRead: 5, match: 'linked' };

const items = [linked, missing, held, planned];
const found: Resolution = { bridgeId: 'x', exact: { id: 'm', title: 'Missing (x)' }, candidates: [] };

describe('planRows', () => {
  test('orders actionable → unresolved → linked, keeping tracker order within a group', () => {
    const rows = planRows(items, new Map([['2', found]]));
    expect(rows.map((r) => `${r.key}:${r.kind}`)).toEqual(['2:resolved', '1:in-library', '3:unresolved', '4:linked']);
    expect(selectableKeys(rows)).toEqual(['2', '1']);
  });

  test('a resolution without a target is still unresolved, and keeps its resolution for the copy', () => {
    const rows = planRows([missing], new Map([['2', { bridgeId: 'x', candidates: [{ id: 'c1', title: 'C1' }] }]]));
    expect(rows[0]?.kind).toBe('unresolved');
    expect(rows[0]?.resolution?.candidates).toHaveLength(1);
  });

  test('a chosen candidate wins over the exact hit', () => {
    const chosen = { id: 'c2', title: 'Picked' };
    const rows = planRows([missing], new Map([['2', { ...found, chosen }]]));
    expect(rows[0]?.target).toEqual({ bridgeId: 'x', series: chosen });
  });

  test('readingKeys picks only selectable reading/rereading rows', () => {
    const rows = planRows(items, new Map([['2', found]]));
    expect(readingKeys(rows)).toEqual(['1']);
  });

  test('unresolvedEntries carries altTitles only when present', () => {
    const rows = planRows([missing, planned], new Map());
    expect(unresolvedEntries(rows)).toEqual([
      { externalId: '2', title: 'Missing', altTitles: ['Alt'] },
      { externalId: 3, title: 'Planned' },
    ]);
  });
});

describe('mergeResolutions', () => {
  test('a later search replaces an earlier miss and drops a pick made on another bridge', () => {
    const prev = new Map<string, Resolution>([['2', { bridgeId: 'x', candidates: [{ id: 'c', title: 'C' }], chosen: { id: 'c', title: 'C' } }]]);
    const next = mergeResolutions(prev, 'y', [{ externalId: 2, exact: { id: 'e', title: 'E' }, candidates: [] }]);
    expect(next.get('2')).toEqual({ bridgeId: 'y', exact: { id: 'e', title: 'E' }, candidates: [] });
  });

  test('a pick survives a re-search on the same bridge', () => {
    const chosen = { id: 'c', title: 'C' };
    const prev = new Map<string, Resolution>([['2', { bridgeId: 'x', candidates: [chosen], chosen }]]);
    const next = mergeResolutions(prev, 'x', [{ externalId: '2', candidates: [chosen] }]);
    expect(next.get('2')?.chosen).toEqual(chosen);
  });
});

describe('rowDescription', () => {
  test('held: links when the library is behind, updates the tracker when ahead (furthest copy)', () => {
    const [row] = planRows([held], new Map());
    expect(rowDescription(row!, { seed: true, nameOf })).toBe('Ch. 20/40 · In library (read 30) → updates tracker');
    const behind = { ...held, entries: [held.entries![0]!] };
    expect(rowDescription(planRows([behind], new Map())[0]!, { seed: true, nameOf })).toBe('Ch. 20/40 · In library (read 12) → links');
  });

  test('resolved: names the bridge hit and the seed only when the toggle is on', () => {
    const [row] = planRows([missing], new Map([['2', found]]));
    expect(rowDescription(row!, { seed: true, nameOf })).toBe('Found on Bridge x: Missing (x) · marks 10 read');
    expect(rowDescription(row!, { seed: false, nameOf })).toBe('Found on Bridge x: Missing (x)');
  });

  test('unresolved: before a search, after a miss, with candidates, after an error', () => {
    expect(rowDescription(planRows([planned], new Map())[0]!, { seed: true, nameOf })).toBe('Planning · Not in library');
    const miss = new Map([['3', { bridgeId: 'x', candidates: [] }]]);
    expect(rowDescription(planRows([planned], miss)[0]!, { seed: true, nameOf })).toBe('Not found on Bridge x');
    const some = new Map([['3', { bridgeId: 'x', candidates: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }]]);
    expect(rowDescription(planRows([planned], some)[0]!, { seed: true, nameOf })).toBe('2 possible matches on Bridge x — tap to choose');
    const err = new Map([['3', { bridgeId: 'x', candidates: [], error: 'boom' }]]);
    expect(rowDescription(planRows([planned], err)[0]!, { seed: true, nameOf })).toBe("Couldn't search Bridge x");
  });

  test('linked rows are inert', () => {
    expect(rowDescription(planRows([linked], new Map())[0]!, { seed: true, nameOf })).toBe('Already linked');
  });

  test('progressLabel falls back to the status without a chapter count', () => {
    expect(progressLabel({ status: 'on-hold' })).toBe('On hold');
    expect(progressLabel({ status: 'reading', chaptersRead: 3 })).toBe('Ch. 3');
  });
});

describe('itemsForImport', () => {
  test('one item per library copy, the chosen target for a find, unchecked rows skipped', () => {
    const rows = planRows(items, new Map([['2', { ...found, exact: { id: 'm', title: 'Missing (x)', thumbnailUrl: 'cover' } }]]));
    const out = itemsForImport(rows, new Set(['1', '2', '3', '4']));
    expect(out.map((i) => `${i.bridgeId}/${i.seriesId}`)).toEqual(['x/m', 'a/held', 'b/held-b']);
    expect(out[0]).toEqual({ externalId: '2', title: 'Missing', status: 'completed', chaptersRead: 10, totalChapters: 10, thumbnailUrl: 'cover', bridgeId: 'x', seriesId: 'm' });
    expect(itemsForImport(rows, new Set(['1']))).toHaveLength(2);
  });
});

describe('batching + summary', () => {
  test('chunk splits evenly with a short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  test('sumImportResults adds counts and concatenates failures', () => {
    const total = sumImportResults([
      { imported: 1, linked: 2, seeded: 1, pushed: 0, failed: [] },
      { imported: 0, linked: 1, seeded: 0, pushed: 1, failed: [{ externalId: 9, bridgeId: 'x', seriesId: 's', error: 'e' }] },
    ]);
    expect(total).toEqual({ imported: 1, linked: 3, seeded: 1, pushed: 1, failed: [{ externalId: 9, bridgeId: 'x', seriesId: 's', error: 'e' }] });
    expect(importSummary(total)).toBe('1 added · 3 linked · 1 updated on tracker · 1 failed');
    expect(importSummary({ imported: 0, linked: 0, seeded: 0, pushed: 0, failed: [] })).toBe('Nothing to import');
  });
});
