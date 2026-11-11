import { describe, expect, test } from 'bun:test';

import { DIRECT_CHAPTER_ID, type ActivityEntry, type Bridge, type HistoryEntry } from '../types';
import { activityRows, coverFileName, historyRows, toWidgetItem, WIDGET_ROWS } from './feed';

const bridge = (id: string, extra: Partial<Bridge> = {}): Bridge => ({
  id,
  name: `${id} (Demo)`,
  nsfw: false,
  capabilities: [],
  ...extra,
});
const known = new Map([
  ['safe', bridge('safe')],
  ['adult', bridge('adult', { nsfw: true })],
  ['gallery', bridge('gallery', { capabilities: ['direct'] })],
]);

/** What the series page reads off a link: the query parsed once, as expo-router parses it. */
const paramsOf = (url: string) => Object.fromEntries(new URLSearchParams(url.slice(url.indexOf('?') + 1)));

const read = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  bridgeId: 'safe',
  seriesId: 's1',
  title: 'One',
  lastReadAt: 1000,
  ...over,
});

describe('historyRows', () => {
  test('a row carries on reading where the series was left', () => {
    const [row] = historyRows(
      [read({ chapterId: 'c7', chapterName: 'Chapter 7', lastPage: 4, pageCount: 20, thumbnailUrl: 'https://x/c(1).jpg' })],
      known,
      true,
    );
    expect(row).toMatchObject({ id: 'safe:s1', title: 'One', detail: 'Chapter 7  ·  5 / 20', at: 1000, progress: 0.25 });
    expect(paramsOf(row!.url)).toEqual({
      id: 's1',
      title: 'One',
      bridge: 'safe%20%28Demo%29',
      bridgeId: 'safe',
      cover: 'https%3A%2F%2Fx%2Fc%281%29.jpg',
      reader: '1',
      start: '4',
      chapterId: 'c7',
      chapterName: 'Chapter 7',
    });
  });

  test('a chapterless series resumes as a direct read', () => {
    const [row] = historyRows([read({ chapterId: DIRECT_CHAPTER_ID, lastPage: 2 })], known, true);
    expect(paramsOf(row!.url)).toMatchObject({ direct: '1', start: '2' });
    expect(paramsOf(row!.url).chapterId).toBeUndefined();
  });

  test('rows swiped out of History and NSFW bridges stay out, and the rest is capped', () => {
    const many = Array.from({ length: WIDGET_ROWS + 3 }, (_, i) => read({ seriesId: `s${i}` }));
    const rows = historyRows([read({ hidden: true }), read({ bridgeId: 'adult', seriesId: 'x' }), ...many], known, true);
    expect(rows.map((r) => r.id)).toEqual(many.slice(0, WIDGET_ROWS).map((h) => `safe:${h.seriesId}`));
  });

  test('NSFW bridges are kept when the stored choice shows them', () => {
    expect(historyRows([read({ bridgeId: 'adult' })], known, false)).toHaveLength(1);
  });
});

const found = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  bridgeId: 'safe',
  seriesId: 's1',
  chapterId: 'c1',
  title: 'One',
  detectedAt: 1000,
  read: false,
  ...over,
});

describe('activityRows', () => {
  test('a series’ unread chapters are one row that reads the newest', () => {
    const [row, ...rest] = activityRows(
      [found({ chapterId: 'c3', chapterName: 'Chapter 3', detectedAt: 3000 }), found({ chapterId: 'c2', detectedAt: 2000 })],
      known,
      true,
    );
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ id: 'safe:s1', detail: '2 new chapters', at: 3000, badge: '2' });
    expect(paramsOf(row!.url)).toMatchObject({ reader: '1', chapterId: 'c3', chapterName: 'Chapter 3', start: '0', picked: '1' });
  });

  test('the badge counts the unread chapters, and History rows carry none', () => {
    expect(activityRows([found()], known, true)[0]!.badge).toBe('1');
    expect(historyRows([read()], known, true)[0]).not.toHaveProperty('badge');
  });

  test('only rows with something left to read are shown', () => {
    const rows = activityRows(
      [found({ seriesId: 'done', read: true }), found({ seriesId: 'gone', removed: true, read: true }), found({ seriesId: 'new' })],
      known,
      true,
    );
    expect(rows.map((r) => r.id)).toEqual(['safe:new']);
  });

  test('a direct bridge’s row says so, and an NSFW bridge’s is left out', () => {
    const rows = activityRows([found({ bridgeId: 'adult' }), found({ bridgeId: 'gallery' })], known, true);
    expect(rows.map((r) => r.id)).toEqual(['gallery:s1']);
    expect(paramsOf(rows[0]!.url).direct).toBe('1');
  });
});

describe('covers', () => {
  test('a cover’s file is named for its URL', () => {
    expect(coverFileName('https://x/a.jpg')).toBe(coverFileName('https://x/a.jpg'));
    expect(coverFileName('https://x/a.jpg')).not.toBe(coverFileName('https://x/b.jpg'));
    expect(coverFileName('https://x/a.jpg')).toMatch(/^[0-9a-f]{24}\.jpg$/);
  });

  test('a row is written with its cover only once the cover is stored', () => {
    const [row] = historyRows([read({ thumbnailUrl: 'https://x/a.jpg' })], known, true);
    expect(toWidgetItem(row!, new Map())).not.toHaveProperty('cover');
    expect(toWidgetItem(row!, new Map())).not.toHaveProperty('thumbnailUrl');
    expect(toWidgetItem(row!, new Map([['https://x/a.jpg', 'a.jpg']])).cover).toBe('a.jpg');
  });
});
