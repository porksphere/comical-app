/**
 * The Browse-selected bridge — the one the Browse tab is showing, which Search INHERITS as its
 * starting point.
 *
 * Inherits, one way. Search reads the selection when it mounts and owns a copy from there on
 * (`useInheritedBridge`); it does not write back. Sharing the observable both ways is the same
 * thing as letting Search RESELECT Browse's bridge behind its back, and it did: a series opened
 * from the cross-bridge Comical home, then a tag chip tapped on it, pointed the search at the
 * series' own bridge — and took the Browse tab underneath with it. Browse came back on a different
 * bridge showing a different grid, which is also a grid without the card the open series page was
 * going to collapse into, so the gallery transition had nothing to land on.
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
import { useCallback, useMemo, useState } from 'react';

import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { useQuery } from '@tanstack/react-query';

import { applyOrder, useBridgeOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
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
/** The Comical bridge's mark as a local image module — passed directly to `BridgeThumb`'s `source`
 *  for the Comical bridge (the way index.tsx already renders it). A DEDICATED asset, not the app
 *  logo: this sits at `BridgeThumbSize` (28pt) beside real bridges' full-bleed square thumbnails,
 *  where the book's page gradients and halftone turn to mush — so it's just the こ on a full-bleed
 *  tile, light-on-dark so the chip keeps an edge on the light theme and stays legible on the dark
 *  one. Corners are clipped by the call sites (`bridgeThumb`/`optionThumb` borderRadius), not baked
 *  into the art. Not resolved to a URI: react-native-web's `Image` has no `resolveAssetSource`, and
 *  `expo-asset` isn't a dependency — a require module works on both. */
export const COMICAL_ICON = require('@/assets/images/comical-bridge.png');
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
 * The SHARED selection — the Browse tab's own. Writing through its `setBridge` moves the Browse
 * tab, which is what makes it the wrong hook for anywhere else (see the module header).
 */
export function useSelectedBridge(): SelectedBridge {
  const bridge = useSelectedBridgeId();
  return useResolvedBridge(bridge, setSelectedBridge);
}

/**
 * The same selection, SEEDED from Browse's and owned from there on — for a screen that picks its
 * own bridge without meaning to move the tab underneath it (Search, and Search embedded as the
 * series page's tag-search layer).
 *
 * A non-reactive `peek` on purpose: this is a starting value, not a subscription. Browse cannot
 * change while a search is up — it is either a pushed screen over the tabs or a layer inside the
 * series modal over them — so there is nothing to stay in sync with, and subscribing would only
 * re-introduce the coupling this hook exists to remove.
 */
export function useInheritedBridge(): SelectedBridge {
  const [bridge, setBridge] = useState<string | null>(() => selectedBridge$.peek());
  return useResolvedBridge(bridge, setBridge);
}

/**
 * Resolves a selected bridge id against the (react-query) bridges list, applying the same
 * Hide-NSFW filter + first-visible fallback the Browse screen used inline. Shared by both hooks
 * above so the resolution lives in exactly one place; they differ only in WHERE the id lives.
 */
function useResolvedBridge(bridge: string | null, setBridge: (id: string) => void): SelectedBridge {
  const ds = useDataSource();
  const mock = useMockActive();
  const hideNsfw = useHideNsfw();

  const bridgesQuery = useQuery({
    queryKey: queryKeys.bridges(mock),
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
    // ALWAYS prepend the synthetic aggregate bridge — first (so it's the default landing bridge too),
    // unconditionally, even with zero real bridges: it's a permanent front door, and a load-time
    // flicker of an empty `real` must never make it vanish. Kept out of raw `bridges`, so the
    // no-bridges onboarding (which checks raw `bridges.length`) still triggers when there's nothing
    // to aggregate — the Comical selector then sits above that onboarding (see index.tsx).
    return [COMICAL_BRIDGE, ...real];
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
    setBridge,
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
