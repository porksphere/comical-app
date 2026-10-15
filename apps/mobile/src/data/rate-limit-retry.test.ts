import { describe, expect, test } from 'bun:test';
import { queryRetry, queryRetryDelay } from './rate-limit-retry';

const limited = (ms: number) => new Error(`getSeriesDetails threw: [rate-limited:${ms}] HTTP 429 from x.test`);

describe('query retry', () => {
  test('an ordinary failure retries once on the default backoff', () => {
    const err = new Error('500 boom');
    expect(queryRetry(0, err)).toBe(true);
    expect(queryRetry(1, err)).toBe(false);
    expect(queryRetryDelay(0, err)).toBe(1000);
  });

  test('a rate-limited failure is retried after the wait it names, a few times', () => {
    const err = limited(25_000);
    expect(queryRetry(0, err)).toBe(true);
    expect(queryRetry(2, err)).toBe(true);
    expect(queryRetry(3, err)).toBe(false);
    expect(queryRetryDelay(0, err)).toBe(25_000);
  });

  test('a long wait is surfaced instead of held on a spinner', () => {
    expect(queryRetry(0, limited(3 * 60 * 60 * 1000))).toBe(false);
  });

  test('a zero wait still pauses a beat', () => {
    expect(queryRetryDelay(0, limited(0))).toBe(1000);
  });
});
