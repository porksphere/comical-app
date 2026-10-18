import { parseRateLimited, parseSeriesGone } from '@comical/contract';

const RATE_LIMITED_ATTEMPTS = 3;
// Longer than this and the screen shows the error: waiting minutes on a spinner reads as a hang.
const MAX_HELD_WAIT_MS = 60_000;

export function rateLimitWait(error: unknown): number | undefined {
  return error instanceof Error ? parseRateLimited(error.message)?.retryAfterMs : undefined;
}

export function queryRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof Error && parseSeriesGone(error.message)) return false;
  const wait = rateLimitWait(error);
  if (wait === undefined) return failureCount < 1;
  return failureCount < RATE_LIMITED_ATTEMPTS && wait <= MAX_HELD_WAIT_MS;
}

export function queryRetryDelay(failureCount: number, error: unknown): number {
  const wait = rateLimitWait(error);
  return wait === undefined ? Math.min(1000 * 2 ** failureCount, 30_000) : Math.max(wait, 1000);
}
