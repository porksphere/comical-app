import { useSyncExternalStore } from 'react';

import { showToast } from '@/components/toast';
import { setRequestErrorListener } from '@/data/api';
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

/**
 * Show every failed request as a red toast while the setting is on. One failure tends to arrive as
 * several (a query and its retry, a screen's parallel requests to the same dead server), so a
 * message identical to the one still on screen is dropped rather than restarting the toast.
 */
export function installErrorToasts(): void {
  let last = { message: '', at: 0 };
  setRequestErrorListener((error) => {
    if (!errorToasts$.on.peek()) return;
    const message = shortError(error);
    const now = Date.now();
    if (message === last.message && now - last.at < ERROR_TOAST_MS) return;
    last = { message, at: now };
    showToast(message, { tone: 'error', durationMs: ERROR_TOAST_MS });
  });
}
