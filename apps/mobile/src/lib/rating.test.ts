import { describe, expect, test } from 'bun:test';

import { formatScore, formatVotes } from './rating';

describe('formatScore', () => {
  test('prints the normalized score out of ten, to one decimal', () => {
    expect(formatScore(0.79)).toBe('7.9');
    expect(formatScore(0.8)).toBe('8.0');
    expect(formatScore(0.7958)).toBe('8.0');
  });

  test('covers both ends of the scale', () => {
    expect(formatScore(0)).toBe('0.0');
    expect(formatScore(1)).toBe('10.0');
  });

  test('clamps a score that escaped the scale', () => {
    expect(formatScore(1.4)).toBe('10.0');
    expect(formatScore(-0.2)).toBe('0.0');
  });
});

describe('formatVotes', () => {
  test('leaves a count under a thousand alone', () => {
    expect(formatVotes(0)).toBe('0');
    expect(formatVotes(999)).toBe('999');
  });

  test('abbreviates thousands, dropping a trailing .0', () => {
    expect(formatVotes(1000)).toBe('1K');
    expect(formatVotes(1280)).toBe('1.3K');
    expect(formatVotes(48_200)).toBe('48.2K');
    expect(formatVotes(99_960)).toBe('100K');
    expect(formatVotes(716_500)).toBe('717K');
  });

  test('never prints "1000K"', () => {
    expect(formatVotes(999_499)).toBe('999K');
    expect(formatVotes(999_500)).toBe('1M');
  });

  test('abbreviates millions', () => {
    expect(formatVotes(2_140_000)).toBe('2.1M');
    expect(formatVotes(150_000_000)).toBe('150M');
  });
});
