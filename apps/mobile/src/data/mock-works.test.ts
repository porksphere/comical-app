import { describe, expect, test } from 'bun:test';

import { MOCK_FIXTURE_COVER } from './mock-assets';
import {
  LONG_TITLE,
  mockGetActivity,
  mockGetChapterPages,
  mockGetHistory,
  mockGetSeriesList,
  mockGrid,
  mockHomeSections,
  mockSeries,
} from './mock';
import { NAMED_WORKS, WORKS } from './mock-works';

const BRIDGES = ['panelfox', 'inkwell', 'driftpage', 'nightshelf'];

describe('the mock catalog is real works', () => {
  test('each work is one series: its id and its title are its own', () => {
    expect(new Set(WORKS.map((w) => w.id)).size).toBe(WORKS.length);
    expect(new Set(WORKS.map((w) => w.title)).size).toBe(WORKS.length);
  });

  test("Black Jack's title and author are as its terms give them", () => {
    const bj = NAMED_WORKS.find((w) => w.id === 'black-jack')!;
    expect(bj.title).toBe('Give My Regards to Black Jack');
    expect(bj.meta.find((c) => c.label === 'AUTHOR')?.value).toBe('SHUHO SATO');
  });

  test('a card opens onto the series it showed, with that series’ chapters and their pages', async () => {
    for (const bridge of BRIDGES) {
      const cards = [...mockHomeSections('home', bridge).flatMap((s) => s.items), ...mockGrid('featured-p1', 24, bridge)];
      for (const c of cards.filter((card) => card.id !== 'featured-long')) {
        const detail = mockSeries(c.id, undefined, bridge);
        expect(detail.title).toBe(c.title);
        expect(detail.cover).toBe(c.cover);
        const work = WORKS.find((w) => w.title === c.title)!;
        const { chapters } = await mockGetSeriesList(bridge, c.id, false);
        expect(chapters!.map((ch) => ch.name).reverse()).toEqual(work.chapters.map((ch) => ch.name));
        const newest = chapters![0]!;
        expect(await mockGetChapterPages(bridge, c.id, newest.id)).toHaveLength(newest.pageCount!);
      }
    }
  });

  test('a shelf lists no series twice', () => {
    for (const bridge of [...BRIDGES, 'coldspine']) {
      const titles = mockGrid('featured-p1', 24, bridge).map((c) => c.title);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  test('the first Featured shelf leads with a series long enough to collapse', async () => {
    const lead = mockGrid('featured-p1', 24, 'panelfox')[0]!;
    expect(lead.title).toBe('Pepper&Carrot');
    expect((await mockGetSeriesList('panelfox', lead.id, false)).chapterCount).toBe(39);
  });

  test('History and Activity name chapters their series has', async () => {
    const history = await mockGetHistory();
    const activity = await mockGetActivity();
    expect(history.length).toBeGreaterThan(0);
    expect(activity.length).toBeGreaterThan(0);
    for (const row of history) {
      const work = WORKS.find((w) => w.title === row.title)!;
      expect(work.chapters.map((c) => c.name)).toContain(row.chapterName!);
      expect(row.lastPage!).toBeLessThan(row.pageCount!);
    }
    for (const row of activity) {
      const work = WORKS.find((w) => w.title === row.title)!;
      expect(work.chapters.map((c) => c.name)).toContain(row.chapterName!);
    }
  });

  test('the fixture series is the one that is not a work', async () => {
    const fixture = mockSeries('featured-long', undefined, 'Panelfox');
    expect(fixture.title).toBe(LONG_TITLE);
    expect(fixture.cover).toBe(MOCK_FIXTURE_COVER);
    expect((await mockGetSeriesList('panelfox', 'featured-long', false)).chapterCount).toBeGreaterThan(40);
  });
});
