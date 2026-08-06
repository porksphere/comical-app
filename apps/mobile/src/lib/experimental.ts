import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * TEMPORARY experiment toggles — a scratch pad for "does the other way still break?", surfaced as
 * Settings switches so a build can be A/B'd on a real device instead of argued about.
 *
 * Everything in here is expected to be DELETED, not grown: each flag exists to settle one question,
 * and once it is settled the losing branch and the flag go together. Nothing else should read this
 * module — a flag that earns a permanent home belongs in a store of its own.
 *
 * Persisted as an OBJECT, never a bare boolean: Legend State's `safeStringify` is
 * `v ? stringify(v) : v`, so `false` reaches AsyncStorage unstringified and crashes native
 * RNCAsyncStorage (`-[__NSCFBoolean length]`) the moment a toggle is turned off. See perf-flags.
 */
export const experimental$ = persisted$('comical:experimental', { nativeSearchStack: false });

/**
 * Open the series page's tag/author/type search as a REAL PUSH on the modal's nested stack — a
 * native card with UIKit's own edge-pop — instead of the in-screen layer it normally is.
 *
 * The question this settles: the layers exist because navigation could not keep the parent screen
 * visible on iOS (a covered nested card is detached by UINavigationController, which is why an
 * earlier build of this branch had to dissolve a drilled series into its parent rather than reveal
 * it). The layer's back-swipe is therefore hand-rolled, and a hand-rolled gesture is a hand-rolled
 * gesture however carefully it is tuned. If react-native-screens no longer detaches, search can be
 * a route and get the real thing.
 *
 * What to look at with it ON, in rough order of how quickly it should show up:
 *   - the edge-swipe on the search itself — this is the actual prize, UIKit's own interactive pop.
 *   - the top chrome: the layer keeps ONE chevron statically stuck across the whole modal, so it
 *     never moves through any navigation. A pushed card brings its own bar, so expect the chevron
 *     to cross-fade or jump where it used to sit still.
 *   - tapping a result card. Drilled series are still LAYERS, and layers live on the stack's root
 *     screen — so the drill pops the search to get back down there, and the search you came from
 *     is gone. That is the cost this whole toggle is about; if it doesn't bother you, the route is
 *     worth finishing properly (drilled series as nested cards too, which is the case that used to
 *     detach).
 *
 * Reactive read via `useSyncExternalStore` for the reason in perf-flags: a bare `use$` isn't
 * recognized as a hook by the React Compiler.
 */
export function useNativeSearchStack(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => experimental$.nativeSearchStack.onChange(onStoreChange),
    () => experimental$.nativeSearchStack.peek(),
    () => experimental$.nativeSearchStack.peek(),
  );
}
