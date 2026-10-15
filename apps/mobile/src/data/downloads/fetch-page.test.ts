import { afterEach, describe, expect, mock, test } from 'bun:test';
import { PageRateLimitedError, rateLimitWaitOf } from '@comical/downloads';

let resolve: (url: string, opts?: { transient?: boolean }) => Promise<string> = async (u) => u;
const asked: { url: string; opts?: { transient?: boolean } }[] = [];
mock.module('../api', () => ({
  resolveAssetSourceCached: (url: string, opts?: { transient?: boolean }) => {
    asked.push({ url, opts });
    return resolve(url, opts);
  },
  invalidateAssetSource: () => {},
}));

const { devicePageFetcher } = await import('./fetch-page');

const CTX = { bridgeId: 'b', seriesId: 's', chapterId: 'c' };
const page = (sourceUrl: string) => ({ index: 0, sourceUrl, file: '', bytes: 0, state: 'pending' as const });
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resolve = async (u) => u;
  asked.length = 0;
});

const routeError = (status: number, body: string, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`${status} ${body}`), { status, headers: new Headers(headers) });

describe('devicePageFetcher', () => {
  test('resolves transiently, so the page is neither prioritised over reading nor cached', async () => {
    resolve = async () => 'data:image/png;base64,AQID';
    const got = await devicePageFetcher(CTX, page('/img-proxy?url=x'));
    expect(asked[0]?.opts).toEqual({ transient: true });
    expect([...got.data]).toEqual([1, 2, 3]);
    expect(got.contentType).toBe('image/png');
  });

  test("a route's 429 becomes a rate-limited error with its relayed wait", async () => {
    resolve = async () => {
      throw routeError(429, '{"error":"[rate-limited:7200000] banned"}', { 'Retry-After': '7200' });
    };
    const err = await devicePageFetcher(CTX, page('/bridges/b/page-image/x')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageRateLimitedError);
    expect(rateLimitWaitOf(err)).toBe(7_200_000);
  });

  test('an upstream 429 through the proxy keeps its Retry-After', async () => {
    resolve = async () => {
      throw routeError(429, 'slow down', { 'Retry-After': '30' });
    };
    const err = await devicePageFetcher(CTX, page('/img-proxy?url=x')).catch((e: unknown) => e);
    expect(rateLimitWaitOf(err)).toBe(30_000);
  });

  test('any other resolve failure stays a plain failure', async () => {
    resolve = async () => {
      throw routeError(500, 'boom');
    };
    const err = await devicePageFetcher(CTX, page('/img-proxy?url=x')).catch((e: unknown) => e);
    expect(rateLimitWaitOf(err)).toBeUndefined();
  });

  test('a direct CDN 429 is rate-limited; a 404 is not', async () => {
    globalThis.fetch = (async (url: string) =>
      url.endsWith('limited')
        ? new Response('', { status: 429, headers: { 'Retry-After': '5' } })
        : new Response('', { status: 404 })) as unknown as typeof fetch;
    const limited = await devicePageFetcher(CTX, page('https://cdn.example.com/limited')).catch((e: unknown) => e);
    expect(rateLimitWaitOf(limited)).toBe(5_000);
    const gone = await devicePageFetcher(CTX, page('https://cdn.example.com/gone')).catch((e: unknown) => e);
    expect(rateLimitWaitOf(gone)).toBeUndefined();
  });
});
