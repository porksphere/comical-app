import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { historyResumeParams, seriesLink } from '@/lib/series-links';

const BRIDGES = ['komga', 'suwayomi', 'kavita', 'opds'];

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
    for (const bridge of [...BRIDGES, 'lanraragi']) {
      const titles = mockGrid('featured-p1', 24, bridge).map((c) => c.title);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  test('the first Featured shelf leads with a series long enough to collapse', async () => {
    const lead = mockGrid('featured-p1', 24, 'komga')[0]!;
    expect(lead.title).toBe('Pepper&Carrot');
    expect((await mockGetSeriesList('komga', lead.id, false)).chapterCount).toBe(39);
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
    const fixture = mockSeries('featured-long', undefined, 'Komga');
    expect(fixture.title).toBe(LONG_TITLE);
    expect(fixture.cover).toBe(MOCK_FIXTURE_COVER);
    expect((await mockGetSeriesList('komga', 'featured-long', false)).chapterCount).toBeGreaterThan(40);
  });
});

describe('the page-turn capture', () => {
  // `.github/workflows/capture-page-turn.yml` opens the reader by a link written out in its env.
  const workflow = readFileSync(join(import.meta.dir, '../../../../.github/workflows/capture-page-turn.yml'), 'utf8');
  const link = /^\s*LINK: '([^']+)'$/m.exec(workflow)![1]!;
  const params = Object.fromEntries(new URL(link).searchParams);

  test('its link is the one a History row for that chapter would open', async () => {
    const work = NAMED_WORKS.find((w) => w.id === 'pepper-and-carrot')!;
    const { chapters } = await mockGetSeriesList(params.bridgeId!, params.id!, false);
    const first = chapters!.find((c) => c.number === 1)!;
    const row = {
      bridgeId: params.bridgeId!,
      seriesId: params.id!,
      title: work.title,
      chapterId: first.id,
      chapterName: first.name,
      lastPage: 0,
      lastReadAt: 0,
    };
    expect(link).toBe(seriesLink(historyResumeParams(row, 'Komga')));
  });

  test('it opens on a chapter whose pages are its own, all three', async () => {
    expect(mockSeries(params.id!, undefined, 'Komga').title).toBe('Pepper&Carrot');
    const pages = await mockGetChapterPages(params.bridgeId!, params.id!, params.chapterId!);
    expect(pages.map((p) => p.split('/pages/')[1])).toEqual(['05.jpg', '06.jpg', '04.jpg']);
  });
});
