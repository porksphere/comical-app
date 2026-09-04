import { describe, expect, test } from 'bun:test';

import { shortChapterName } from '@/lib/chapter-label';

describe('shortChapterName', () => {
  test('keeps the number and drops the title', () => {
    expect(shortChapterName('Chapter 176 — The Coast Road')).toBe('Ch. 176');
    expect(shortChapterName('Ch. 10.5: Interlude')).toBe('Ch. 10.5');
    expect(shortChapterName('176')).toBe('Ch. 176');
    expect(shortChapterName('#42 The Answer')).toBe('Ch. 42');
    expect(shortChapterName('Vol. 3 Ch. 21')).toBe('Ch. 21');
  });

  test('an episode keeps its own word', () => {
    expect(shortChapterName('Episode 12 - Night')).toBe('Ep. 12');
  });

  test('a name with no leading number is left whole', () => {
    expect(shortChapterName('Prologue')).toBe('Prologue');
    expect(shortChapterName('  The Coast Road ')).toBe('The Coast Road');
  });
});
