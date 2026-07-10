/**
 * The Browse-selected bridge — shared between the Browse tab and the pushed
 * Search screen so search inherits whichever bridge Browse is currently on.
 *
 * Only the selected bridge *name* is app state; everything else here is derived
 * from the react-query bridges cache (`queryKeys.bridges()`), so this stays a
 * thin Legend State observable over the name and re-derives the resolved bridge
 * per screen — never a mirror of the server list (see AGENTS.md → State).
 *
 * In-memory (`observable`, not `persisted$`): matches Browse's previous
 * `useState<string | null>(null)` default — the selection resets on relaunch and
 * falls back to the first visible bridge. Switching to `persisted$` later is a
 * one-line change if we want the choice to survive restarts.
 */
import { useCallback, useMemo } from 'react';

import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';
import type { Bridge } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';

export const selectedBridge$ = observable<string | null>(null);

/** Stable module-level setter — writing the shared observable never needs a closure over render
 *  state, so consumers (e.g. the Browse crossfade's deferred commit) get a fixed reference. */
export const setSelectedBridge = (name: string) => selectedBridge$.set(name);

/**
 * The reactive selected-bridge name.
 *
 * Isolated into its own hook on purpose: the React Compiler (`experiments.reactCompiler`) detects
 * hooks by name — `use` + an uppercase letter — so it does NOT recognise `use$` (the `$` isn't a
 * letter) and treats it as a plain call. Calling `use$` directly *before* another hook like
 * `useQuery` in the same compiled function throws off the compiler's hook-slot accounting and
 * crashes at runtime ("Cannot read property 'length' of undefined" in `updateEffectImpl`). Nesting
 * it here — with nothing after it — keeps the caller's hook accounting correct, the same safe shape
 * `useHideNsfw` already uses.
 */
function useSelectedBridgeName(): string | null {
  return use$(selectedBridge$);
}

export type SelectedBridge = {
  /** The raw selected bridge name, or null before the user has picked one. */
  bridge: string | null;
  setBridge: (name: string) => void;
  bridges: Bridge[];
  visibleBridges: Bridge[];
  /** The resolved bridge for the current selection (falls back to the first
   *  visible bridge when the selection isn't among the visible ones). */
  currentBridge: Bridge | undefined;
  bridgeId: string | undefined;
  bridgeThumbnails: Record<string, string>;
  directBridge: boolean;
  bridgesError: string | null;
  bridgesLoaded: boolean;
  refetchBridges: () => void;
};

/**
 * Resolves the shared selected bridge against the (react-query) bridges list,
 * applying the same Hide-NSFW filter + first-visible fallback the Browse screen
 * used inline. Consumed by both Browse (`(tabs)/index.tsx`) and Search
 * (`search.tsx`) so the resolution lives in exactly one place.
 */
export function useSelectedBridge(): SelectedBridge {
  const ds = useDataSource();
  const hideNsfw = useHideNsfw();
  const bridge = useSelectedBridgeName();

  const bridgesQuery = useQuery({
    queryKey: queryKeys.bridges(),
    queryFn: ({ signal }) => ds.getBridges(signal),
  });
  const bridges = useMemo(() => bridgesQuery.data ?? [], [bridgesQuery.data]);
  const bridgesError = bridgesQuery.isError
    ? friendlyError(bridgesQuery.error, 'Failed to load bridges. Try again.')
    : null;
  // Distinguishes "still fetching" from "fetched, and there are none" — both start out as an empty
  // `bridges` array, so without this the no-bridges placeholder would flash before the first load
  // resolves.
  const bridgesLoaded = bridgesQuery.isFetched;

  const visibleBridges = useMemo(
    () => (hideNsfw ? bridges.filter((b) => !b.nsfw) : bridges),
    [bridges, hideNsfw],
  );
  // Falls back to the first visible bridge whenever the sticky selection isn't among the
  // currently-visible ones (initial load, or hidden by Hide NSFW) — derived at render instead of
  // synced via an effect, so toggling Hide NSFW back off restores the original selection.
  const currentBridge = visibleBridges.find((b) => b.name === bridge) ?? visibleBridges[0];
  const bridgeId = currentBridge?.id;
  const bridgeThumbnails = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of visibleBridges) if (b.thumbnail) map[b.name] = b.thumbnail;
    return map;
  }, [visibleBridges]);
  const directBridge = currentBridge?.capabilities.includes('direct') ?? false;

  const refetchBridges = useCallback(() => void bridgesQuery.refetch(), [bridgesQuery]);

  return {
    bridge,
    setBridge: setSelectedBridge,
    bridges,
    visibleBridges,
    currentBridge,
    bridgeId,
    bridgeThumbnails,
    directBridge,
    bridgesError,
    bridgesLoaded,
    refetchBridges,
  };
}
