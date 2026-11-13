/**
 * The warm-ahead: at most two loads at once, taken in reading order, and whatever the reader moves
 * away from cancelled — a warm waiting on a paced bridge otherwise holds one of the browser's
 * connections to our server, which the rest of the app's requests queue behind.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

type Warm = { uri: string; done: () => void; cancelled: boolean };
let warms: Warm[] = [];

mock.module('@/components/reader/image-progress', () => ({
  warmImage: (uri: string, onDone?: () => void) => {
    const w: Warm = { uri, done: () => onDone?.(), cancelled: false };
    warms.push(w);
    return () => {
      w.cancelled = true;
      onDone?.();
    };
  },
}));
// Over HTTP a resolve is immediate: the page path is its own URL.
mock.module('@/data/api', () => ({
  assetResolvesInFlight: () => 0,
  resolveAssetSourceCached: (p: string) => Promise.resolve(`http://server${p}`),
  supersedeBackgroundResolves: () => {},
}));
mock.module('@/lib/gesture-trace', () => ({ traceJS: () => {} }));

const { warmPageImages } = await import('./warm-pages');

// Two ticks: the resolves land, then the pump they schedule runs.
const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};
const live = () => warms.filter((w) => !w.cancelled).map((w) => w.uri.replace('http://server', ''));
let n = 0;
/** Unique pages per test: the module's "already warmed" memo outlives each test. */
const pages = (...xs: number[]) => {
  const base = `/c${++n}/`;
  return xs.map((x) => `${base}${x}`);
};

beforeEach(() => {
  // Leave nothing running from a previous test.
  warmPageImages([]);
  warms = [];
});

describe('warmPageImages', () => {
  test('warms in reading order, two at a time', async () => {
    const window = pages(2, 3, 4, 5);
    warmPageImages(window);
    await flush();
    expect(live()).toEqual([window[0], window[1]]);
    warms[0]!.done();
    expect(live()).toEqual([window[0], window[1], window[2]]);
    warms[1]!.done();
    warms[2]!.done();
    expect(warms.map((w) => w.uri.replace('http://server', ''))).toEqual(window);
  });

  test('a new window cancels loads and drops waits outside it', async () => {
    const first = pages(1, 2, 3, 4);
    warmPageImages(first);
    await flush();
    expect(live()).toEqual([first[0], first[1]]);
    const next = [first[3]!];
    warmPageImages(next);
    await flush();
    // 1 and 2 were loading and are stopped; 3 never starts; 4 is still wanted.
    expect(warms.slice(0, 2).every((w) => w.cancelled)).toBe(true);
    expect(live()).toEqual([first[3]]);
  });

  test('a page cancelled away from is warmed again when the reader comes back', async () => {
    const [a, b] = pages(1, 2);
    warmPageImages([a!]);
    await flush();
    warmPageImages([b!]);
    await flush();
    warmPageImages([a!]);
    await flush();
    expect(live()).toEqual([a]);
    expect(warms.filter((w) => w.uri.endsWith(a!)).length).toBe(2);
  });

  test('a finished warm is not repeated', async () => {
    const [a] = pages(1);
    warmPageImages([a!]);
    await flush();
    warms[0]!.done();
    warmPageImages([a!]);
    await flush();
    expect(warms.length).toBe(1);
  });
});
