import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
const feedTint$ = persisted$('comical:feedTint', { enabled: true });

/** Whether a feed tints the page behind its sections — see `FeedBackdrop`.
 *  A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useFeedTint(): boolean {
  return use$(feedTint$.enabled) ?? true;
}

export function setFeedTint(enabled: boolean): void {
  feedTint$.enabled.set(enabled);
}
