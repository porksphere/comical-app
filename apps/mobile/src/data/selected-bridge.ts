/**
 * The Browse-selected bridge — shared between the Browse tab and the pushed
 * Search screen so search inherits whichever bridge Browse is currently on.
 *
 * Only the selected bridge *id* is app state; everything else here is derived
 * from the react-query bridges cache (`queryKeys.bridges()`), so this stays a
 * thin Legend State observable over the id and re-derives the resolved bridge
 * per screen — never a mirror of the server list (see AGENTS.md → State).
 *
 * Keyed by **id, not display name**: bridge ids are globally unique (publisher-scoped, e.g.
 * `scope.name`), so two registries offering a same-named bridge stay distinct selections. The
 * dropdown maps id → name for display (`bridgeLabels`); nothing user-facing shows the raw id.
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

import { applyOrder, useBridgeOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';
import type { Bridge } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';

export const selectedBridge$ = observable<string | null>(null);

/** Stable module-level setter — writing the shared observable never needs a closure over render
 *  state, so consumers (e.g. the Browse crossfade's deferred commit) get a fixed reference.
 *  Takes a bridge **id** (see the module header). */
export const setSelectedBridge = (id: string) => selectedBridge$.set(id);

/** Id of the synthetic "Comical" aggregate bridge that fans out over every real installed bridge
 *  (cross-bridge home + search). It is NOT a real registry bridge — it's injected into
 *  `visibleBridges` below and branched on wherever a bridge id drives a fetch (Browse home, Search).
 *  Always present (when there's ≥1 real bridge) and first, so it's also the default landing bridge. */
export const COMICAL_BRIDGE_ID = 'comical';
const COMICAL_BRIDGE: Bridge = { id: COMICAL_BRIDGE_ID, name: 'Comical', nsfw: false, capabilities: [] };
/** The app logo as a local image module — passed directly to `BridgeThumb`'s `source` for the Comical
 *  bridge (the way index.tsx already renders it). Not resolved to a URI: react-native-web's `Image`
 *  has no `resolveAssetSource`, and `expo-asset` isn't a dependency — a require module works on both. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const COMICAL_ICON = require('@/assets/images/comical-logo.png');
/** Whether a selected bridge id is the synthetic aggregate. */
export const isComicalBridge = (bridgeId: string | undefined): boolean => bridgeId === COMICAL_BRIDGE_ID;

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
function useSelectedBridgeId(): string | null {
  return use$(selectedBridge$);
}

export type SelectedBridge = {
  /** The raw selected bridge id, or null before the user has picked one. */
  bridge: string | null;
  setBridge: (id: string) => void;
  bridges: Bridge[];
  visibleBridges: Bridge[];
  /** The resolved bridge for the current selection (falls back to the first
   *  visible bridge when the selection isn't among the visible ones). */
  currentBridge: Bridge | undefined;
  bridgeId: string | undefined;
  /** Thumbnail URLs keyed by bridge **id** (the dropdown's option values are ids). */
  bridgeThumbnails: Record<string, string>;
  /** Display names keyed by bridge **id** — maps the dropdown's id option values back to labels. */
  bridgeLabels: Record<string, string>;
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
  const bridge = useSelectedBridgeId();

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

  // Apply the user's saved order before filtering, so the selector lists bridges in the same order
  // the Bridges page does (the order array spans all bridges; hidden ones just filter out after).
  const order = useBridgeOrder();
  const orderedBridges = useMemo(() => applyOrder(bridges, order, (b) => b.id), [bridges, order]);
  const visibleBridges = useMemo(() => {
    const real = hideNsfw ? orderedBridges.filter((b) => !b.nsfw) : orderedBridges;
    // Prepend the synthetic aggregate bridge — always first (so it's the default landing bridge too),
    // but only when there's at least one real bridge to aggregate. Kept out of raw `bridges` so the
    // no-bridges empty state (which checks raw `bridges.length`) still fires with zero real bridges.
    return real.length > 0 ? [COMICAL_BRIDGE, ...real] : real;
  }, [orderedBridges, hideNsfw]);
  // Falls back to the first visible bridge whenever the sticky selection isn't among the
  // currently-visible ones (initial load, or hidden by Hide NSFW) — derived at render instead of
  // synced via an effect, so toggling Hide NSFW back off restores the original selection.
  const currentBridge = visibleBridges.find((b) => b.id === bridge) ?? visibleBridges[0];
  const bridgeId = currentBridge?.id;
  const bridgeThumbnails = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of visibleBridges) if (b.thumbnail) map[b.id] = b.thumbnail;
    return map;
  }, [visibleBridges]);
  const bridgeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of visibleBridges) map[b.id] = b.name;
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
    bridgeLabels,
    directBridge,
    bridgesError,
    bridgesLoaded,
    refetchBridges,
  };
}
