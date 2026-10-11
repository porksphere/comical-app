import { useSyncExternalStore } from 'react';

import { showToast } from '@/components/toast';
import { setRequestErrorListener } from '@/data/api';
import { isMissingBridgeRequest } from '@/data/known-bridges';
import { queryClient } from '@/data/query-client';
import type { Bridge, MissingBridge } from '@/data/types';
import { shortError } from '@/lib/friendly-error';
import { persisted$ } from '@/lib/observable';

/** An object, not a bare boolean — see `lightCards$` for why a persisted `false` crashes. */
export const errorToasts$ = persisted$('comical:error-toasts', { on: true });

export function useErrorToasts(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => errorToasts$.on.onChange(onStoreChange),
    () => errorToasts$.on.peek(),
    () => errorToasts$.on.peek(),
  );
}

const ERROR_TOAST_MS = 4000;

/** Out of the cache `useBridgeMap` keeps warm — never a fetch of its own from inside a failure. */
function cachedBridgeLists(): { installed: Bridge[]; missing: MissingBridge[] } {
  const installed: Bridge[] = [];
  const missing: MissingBridge[] = [];
  for (const [key, data] of queryClient.getQueriesData<Bridge[] | MissingBridge[]>({ queryKey: ['bridges'] })) {
    if (!Array.isArray(data)) continue;
    if (key.length === 2) installed.push(...(data as Bridge[]));
    else if (key[2] === 'missing') missing.push(...(data as MissingBridge[]));
  }
  return { installed, missing };
}

/**
 * Show every failed request as a red toast while the setting is on. One failure tends to arrive as
 * several (a query and its retry, a screen's parallel requests to the same dead server), so a
 * message identical to the one still on screen is dropped rather than restarting the toast. Requests
 * to an uninstalled bridge are skipped: the series page says that itself.
 */
export function installErrorToasts(): void {
  let last = { message: '', at: 0 };
  setRequestErrorListener((error, path) => {
    if (!errorToasts$.on.peek()) return;
    const { installed, missing } = cachedBridgeLists();
    if (isMissingBridgeRequest(path, installed, missing)) return;
    const message = shortError(error);
    const now = Date.now();
    if (message === last.message && now - last.at < ERROR_TOAST_MS) return;
    last = { message, at: now };
    showToast(message, { tone: 'error', durationMs: ERROR_TOAST_MS });
  });
}
