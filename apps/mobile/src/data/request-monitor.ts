/**
 * What the app's requests are doing right now, for the request overlay (Settings → General). Fed by
 * the transport wrapper in `api.ts`, so it sees every API call on every platform — including the
 * on-device runtime, whose rate-limiter queue lives inside the native JS engine where nothing else
 * can read it. A request that has been in flight for a while is one waiting on that queue or on the
 * source; a request that comes back as a timeout or a rate-limit hold is recorded for a few seconds.
 *
 * Nothing is tracked while the overlay is off: the bookkeeping is skipped at the call, not hidden.
 */
import { parseRateLimited } from '@comical/contract';
import { observable } from '@legendapp/state';
import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

export const requestOverlay$ = persisted$('comical:request-overlay', { on: false });

export function useRequestOverlayEnabled(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => requestOverlay$.on.onChange(onStoreChange),
    () => requestOverlay$.on.peek(),
    () => requestOverlay$.on.peek(),
  );
}

export type InFlightRequest = { id: number; label: string; startedAt: number };
export type FailureKind = 'timeout' | 'held' | 'error';
export type RecentFailure = { id: number; label: string; kind: FailureKind; detail: string; at: number };

export type RequestMonitorState = { inFlight: InFlightRequest[]; recent: RecentFailure[] };

const monitor$ = observable<RequestMonitorState>({ inFlight: [], recent: [] });

const RECENT_MAX = 4;
export const RECENT_TTL_MS = 15_000;

let seq = 0;

/** `/bridges/<id>/series/<sid>/chapters?x` → `<id> chapters`; other routes keep their first two segments. */
export function requestLabel(path: string): string {
  const segments = path.split('?')[0]!.split('/').filter(Boolean);
  if (segments[0] === 'bridges' && segments[1]) {
    const verb = segments[segments.length - 1]!;
    return segments.length > 2 && verb !== segments[1] ? `${segments[1]} ${verb}` : segments[1];
  }
  return segments.slice(0, 2).join('/') || '/';
}

export function classifyFailure(message: string): { kind: FailureKind; detail: string } {
  const held = parseRateLimited(message);
  if (held) return { kind: 'held', detail: `held ${Math.ceil(held.retryAfterMs / 1000)}s` };
  const lower = message.toLowerCase();
  if (lower.includes('exceeded') || lower.includes('timeout') || lower.includes('timed out')) {
    return { kind: 'timeout', detail: 'timed out' };
  }
  return { kind: 'error', detail: message.slice(0, 40) };
}

/** Start tracking a request; call the returned function when it settles, however it settled. */
export function trackRequest(path: string): () => void {
  if (!requestOverlay$.on.peek()) return () => {};
  const id = ++seq;
  monitor$.inFlight.push({ id, label: requestLabel(path), startedAt: Date.now() });
  return () => {
    const list = monitor$.inFlight.peek();
    const index = list.findIndex((r) => r.id === id);
    if (index >= 0) monitor$.inFlight.splice(index, 1);
  };
}

export function noteRequestFailure(path: string | undefined, error: Error): void {
  if (!requestOverlay$.on.peek()) return;
  const { kind, detail } = classifyFailure(error.message);
  const at = Date.now();
  const kept = monitor$.recent.peek().filter((f) => at - f.at < RECENT_TTL_MS);
  monitor$.recent.set([...kept, { id: ++seq, label: requestLabel(path ?? ''), kind, detail, at }].slice(-RECENT_MAX));
}

/** Drop recorded failures older than the TTL; the overlay calls it on its tick. */
export function expireRecentFailures(now = Date.now()): void {
  const list = monitor$.recent.peek();
  const kept = list.filter((f) => now - f.at < RECENT_TTL_MS);
  if (kept.length !== list.length) monitor$.recent.set(kept);
}

export function peekRequestMonitor(): RequestMonitorState {
  return monitor$.peek();
}

export function useRequestMonitor(): RequestMonitorState {
  return useSyncExternalStore(
    (onStoreChange) => monitor$.onChange(onStoreChange),
    () => monitor$.peek(),
    () => monitor$.peek(),
  );
}

export function resetRequestMonitorForTests(): void {
  monitor$.set({ inFlight: [], recent: [] });
}
