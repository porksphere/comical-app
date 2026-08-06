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
 * Run the series page's in-screen LAYERS as real pushes on the modal's nested stack instead: the
 * tag/author/type search becomes a native card with UIKit's own edge-pop (`app/series/search.tsx`),
 * and a series drilled from a related rail or a search result becomes one too
 * (`app/series/related.tsx`).
 *
 * THE QUESTION THIS SETTLES. Layers exist because navigation could not keep the parent screen
 * visible on iOS: UINavigationController detaches a covered card's view, which is why an earlier
 * build of this branch had to dissolve a drilled series into its parent instead of revealing it
 * (see the dissolve-to-parent commit, whose message says "the screen is only the static backdrop
 * by then"). The price of layers is that every gesture on them is hand-rolled, and a hand-rolled
 * gesture is a hand-rolled gesture however carefully it is tuned. If react-native-screens no
 * longer detaches, all of this can be routes.
 *
 * WHAT TO LOOK AT with it ON:
 *   - The edge-swipe on the SEARCH — the prize, UIKit's own interactive pop, and the only place
 *     the native gesture is left enabled.
 *   - THE ACTUAL TEST: open a series, tap a tag, tap a result card, then collapse that drilled
 *     series back out. Is the search you came from LIVE underneath it the whole way, or does the
 *     collapse play over a flat backdrop? The drilled route is deliberately transparent with no
 *     native transition, exactly like the modal root, so there is nothing to hide the answer. That
 *     one observation is what the whole toggle exists for.
 *   - The top chrome: the layer keeps ONE chevron statically stuck across the whole modal, so it
 *     never moves through any navigation. Pushed cards bring their own bars, so expect the chevron
 *     to cross-fade or jump where it used to sit still.
 *
 * The drilled route keeps its own zoom collapse and has the native edge-pop turned OFF — racing
 * the two would make the result unreadable, and the gesture was never the question there.
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
