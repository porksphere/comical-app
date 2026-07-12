import { useEffect } from 'react';
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/** How far the content dims while the new data loads behind it. Deliberately a dim, not a fade-out:
 *  the old rows stay readable, which is what says "refreshing this", not "swapping this". */
export const REVEAL_DIM = 0.45;
export const REVEAL_MS = 200;

/**
 * The shared "this content is being refreshed" dim: ease the grid down to {@link REVEAL_DIM} while a
 * new scope's data loads, then back to full once it settles.
 *
 * Drive it from react-query's `isPlaceholderData` — under `keepPreviousData` that's true exactly when
 * the query KEY changed and the previous scope's rows are still on screen (a new search, a filter or
 * sort change, a page/list switch). A plain `refetch()` of the same key — pull-to-refresh — does NOT
 * set it, so a refresh doesn't dim: it has its own affordance (the pull spinner holding the content
 * down), and dimming under it would double-signal the same thing.
 *
 * This is the counterpart to the full-surface crossfade: a crossfade is for a WHOLESALE swap (bridge
 * or page — a different surface entirely), where dissolving is honest because nothing carries over. A
 * refinement of the same surface keeps its rows in place and just dims them, so the user's context
 * (scroll position, what's on screen) visibly survives the update. Callers suppress the dim while a
 * crossfade owns the transition, so the two never run at once.
 */
export function useRevealDim(updating: boolean) {
  const reveal = useSharedValue(1);
  useEffect(() => {
    reveal.value = withTiming(updating ? REVEAL_DIM : 1, { duration: REVEAL_MS, easing: Easing.out(Easing.quad) });
  }, [updating, reveal]);
  // `style` is the ready-made opacity style for the simple single-opacity case (apply it to the list
  // wrapper so every cell can be a plain View — no Reanimated Animated.View per card). `value` exposes
  // the raw shared value for callers that must COMBINE this dim with another animated opacity (e.g.
  // Browse's crossfade): two opacity styles in an array override rather than multiply, so they have to
  // be multiplied into one style.
  const style = useAnimatedStyle(() => ({ opacity: reveal.value }));
  return { style, value: reveal };
}
