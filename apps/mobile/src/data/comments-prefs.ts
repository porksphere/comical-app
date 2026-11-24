/**
 * Whether comments are shown: everywhere (Settings → General) and per bridge (the bridge's own
 * settings). On unless turned off. App-local and persisted; a bridge is hidden when its id maps to
 * `true`.
 */
import { observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';

import type { Bridge } from '@/data/types';
import { persisted$ } from '@/lib/observable';

import { commentScopes, type CommentScopes } from './comments';

const commentsPrefs$ = persisted$<{ enabled: boolean; hiddenBridges: Record<string, boolean> }>('comical:comments', {
  enabled: true,
  hiddenBridges: {},
});

// Every read below is `useSelector`, never `use$`: the React Compiler knows a hook by its name,
// and a `use$` it takes for a plain call is memoized and skipped on a later render, which changes
// the hook count under whatever called it (see AGENTS.md on Legend State reads).
export function useCommentsEnabled(): boolean {
  return useSelector(commentsPrefs$.enabled) ?? true;
}

export function setCommentsEnabled(enabled: boolean): void {
  commentsPrefs$.enabled.set(enabled);
}

/** `[shown, setShown]` for one bridge's settings toggle. The record is replaced whole, so every
 *  reader of it re-renders (see `useComicalExcluded`). */
export function useBridgeCommentsShown(bridgeId: string): readonly [boolean, (shown: boolean) => void] {
  const hidden = useSelector(commentsPrefs$.hiddenBridges) ?? {};
  return [
    !hidden[bridgeId],
    (shown: boolean) => commentsPrefs$.hiddenBridges.set({ ...commentsPrefs$.hiddenBridges.peek(), [bridgeId]: !shown }),
  ] as const;
}

/** Which of this bridge's threads to offer, after both switches. */
export function useCommentScopes(bridge: Pick<Bridge, 'id' | 'comments'> | undefined): CommentScopes {
  const enabled = useCommentsEnabled();
  const hidden = useSelector(commentsPrefs$.hiddenBridges) ?? {};
  return commentScopes(bridge?.comments, { enabled, bridgeHidden: !!(bridge && hidden[bridge.id]) });
}

/** The order each bridge's threads were last read in, for the session: a pick on one thread holds
 *  on the next from the same source, and a restart goes back to the source's own default. */
const threadSort$ = observable<Record<string, string>>({});

/**
 * `[sort, setSort]` for a bridge's threads: the remembered pick while the bridge still offers it,
 * else its first sort (the contract's default), else nothing for a source with one order.
 */
export function useThreadSort(
  bridgeId: string,
  sorts: readonly { id: string }[] | undefined,
): readonly [string | undefined, (sort: string) => void] {
  const picked = useSelector(() => threadSort$[bridgeId]?.get());
  const sort = sorts?.some((s) => s.id === picked) ? picked : sorts?.[0]?.id;
  return [sort, (next: string) => threadSort$.set({ ...threadSort$.peek(), [bridgeId]: next })] as const;
}
