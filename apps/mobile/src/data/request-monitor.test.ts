import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { observable } from '@legendapp/state';

mock.module('@/lib/observable', () => ({
  persisted$: (_name: string, initial: unknown) => observable(initial),
  whenPersistLoaded: async () => {},
}));

const {
  classifyFailure,
  expireRecentFailures,
  noteRequestFailure,
  peekRequestMonitor,
  RECENT_TTL_MS,
  requestLabel,
  requestOverlay$,
  resetRequestMonitorForTests,
  subscribeRequestMonitor,
  trackRequest,
} = await import('./request-monitor');
type RequestMonitorState = import('./request-monitor').RequestMonitorState;

describe('requestLabel', () => {
  test('names the bridge and the route', () => {
    expect(requestLabel('/bridges/pub.x/series/abc/chapters?lang=en')).toBe('pub.x chapters');
    expect(requestLabel('/bridges/pub.x/search?q=a')).toBe('pub.x search');
    expect(requestLabel('/bridges/pub.x')).toBe('pub.x');
  });
  test('keeps two segments of anything else', () => {
    expect(requestLabel('/library/entries?x=1')).toBe('library/entries');
    expect(requestLabel('/')).toBe('/');
  });
});

describe('classifyFailure', () => {
  test('a rate-limited message is a hold with its wait', () => {
    expect(classifyFailure('[rate-limited:12000] getChapters exceeded 300000ms')).toEqual({ kind: 'held', detail: 'held 12s' });
  });
  test('a timeout is a timeout', () => {
    expect(classifyFailure('getChapters exceeded 30000ms').kind).toBe('timeout');
    expect(classifyFailure('Request timed out').kind).toBe('timeout');
  });
  test('anything else keeps a short message', () => {
    expect(classifyFailure('HTTP 500 from the source')).toEqual({ kind: 'error', detail: 'HTTP 500 from the source' });
  });
});

describe('tracking', () => {
  beforeEach(() => {
    resetRequestMonitorForTests();
    requestOverlay$.on.set(true);
  });

  test('records nothing while the overlay is off', () => {
    requestOverlay$.on.set(false);
    const settled = trackRequest('/bridges/b/search');
    noteRequestFailure('/bridges/b/search', new Error('x exceeded 1ms'));
    expect(peekRequestMonitor()).toEqual({ inFlight: [], recent: [] });
    settled();
  });

  test('a request is in flight until it settles', () => {
    const settled = trackRequest('/bridges/b/search?q=1');
    expect(peekRequestMonitor().inFlight.map((r) => r.label)).toEqual(['b search']);
    settled();
    expect(peekRequestMonitor().inFlight).toHaveLength(0);
    settled();
    expect(peekRequestMonitor().inFlight).toHaveLength(0);
  });

  test('every change hands subscribers a new snapshot', () => {
    const seen: RequestMonitorState[] = [];
    const unsubscribe = subscribeRequestMonitor(() => seen.push(peekRequestMonitor()));
    const before = peekRequestMonitor();
    const settled = trackRequest('/bridges/b/search');
    noteRequestFailure('/bridges/b/latest', new Error('x exceeded 1ms'));
    settled();
    expect(seen).toHaveLength(3);
    expect(new Set([before, ...seen]).size).toBe(4);
    expect(seen[0]!.inFlight).not.toBe(before.inFlight);
    expect(seen[1]!.recent).not.toBe(seen[0]!.recent);
    unsubscribe();
    trackRequest('/bridges/b/search');
    expect(seen).toHaveLength(3);
  });

  test('recent failures are capped and expire', () => {
    for (let i = 0; i < 6; i++) noteRequestFailure(`/bridges/b/${i}`, new Error('x exceeded 1ms'));
    const { recent } = peekRequestMonitor();
    expect(recent).toHaveLength(4);
    expect(recent[0]!.label).toBe('b 2');
    expect(recent[0]!.kind).toBe('timeout');
    expireRecentFailures(Date.now() + RECENT_TTL_MS + 1);
    expect(peekRequestMonitor().recent).toHaveLength(0);
  });
});
