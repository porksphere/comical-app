/**
 * Progress fractions. The regression pinned here: series progress must be CHAPTER-weighted, because
 * a lazily-enqueued chapter has `pageCount: 0` until the engine resolves its page list — under the
 * old page-weighted sum such chapters vanished from the denominator, so a big queue's progress
 * tracked whichever single chapter had resolved.
 */
import { describe, expect, test } from 'bun:test';
import type { DownloadedChapter } from '@comical/downloads';
import { chapterFraction, overallProgress, seriesFraction } from './derive';

function chapter(over: Partial<DownloadedChapter>): DownloadedChapter {
  return {
    bridgeId: 'b',
    seriesId: 's',
    chapterId: 'c',
    pageCount: 0,
    completedPages: 0,
    bytes: 0,
    state: 'queued',
    addedAt: 0,
    ...over,
  };
}

describe('seriesFraction', () => {
  test('unresolved (pageCount 0) chapters still weigh in as pending work', () => {
    const chapters = [
      chapter({ chapterId: 'done', state: 'complete', pageCount: 20, completedPages: 20 }),
      chapter({ chapterId: 'half', state: 'downloading', pageCount: 10, completedPages: 5 }),
      // Two lazily-enqueued chapters, page lists not resolved yet.
      chapter({ chapterId: 'lazy1', pagesResolved: false }),
      chapter({ chapterId: 'lazy2', pagesResolved: false }),
    ];
    // Equal shares: (1 + 0.5 + 0 + 0) / 4 — NOT (25/30), which ignored the lazy pair entirely.
    expect(seriesFraction(chapters)).toBeCloseTo(0.375);
  });

  test('a fully complete series is 1; an empty one is 0', () => {
    expect(seriesFraction([chapter({ state: 'complete', pageCount: 3, completedPages: 3 })])).toBe(1);
    expect(seriesFraction([])).toBe(0);
  });
});

describe('chapterFraction', () => {
  test('complete is 1 even with an unknown page count; unresolved is 0', () => {
    expect(chapterFraction(chapter({ state: 'complete' }))).toBe(1);
    expect(chapterFraction(chapter({ pagesResolved: false }))).toBe(0);
    expect(chapterFraction(chapter({ state: 'downloading', pageCount: 4, completedPages: 1 }))).toBe(0.25);
  });
});

describe('overallProgress', () => {
  test('chapter-weighted across series, inProgress while anything is pending', () => {
    const bySeries = [
      {
        bridgeId: 'b',
        seriesId: 's1',
        title: 'S1',
        chapterCount: 2,
        bytes: 0,
        addedAt: 0,
        chapters: [
          chapter({ state: 'complete', pageCount: 10, completedPages: 10 }),
          chapter({ pagesResolved: false }),
        ],
      },
    ];
    const { fraction, inProgress } = overallProgress(bySeries);
    expect(fraction).toBeCloseTo(0.5);
    expect(inProgress).toBe(true);
  });
});
