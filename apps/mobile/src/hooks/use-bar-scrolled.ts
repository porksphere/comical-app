import { useState } from 'react';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';

/**
 * How far a list scrolls from its rest at the top before the bar over it takes its material
 * (`NativeTabHeader scrolled`): a few points, so the bar is bare over the top of the page and
 * frosted once content is moving under it, as the series page's is once its title is past.
 */
export const BAR_SCROLLED_AT = 8;

/** Whether the list has scrolled past `BAR_SCROLLED_AT`, as state: a crossing re-renders, a scroll
 *  does not. */
export function useBarScrolled(scrollY: SharedValue<number>): boolean {
  const [scrolled, setScrolled] = useState(false);
  useAnimatedReaction(
    () => scrollY.value > BAR_SCROLLED_AT,
    (past, prev) => {
      if (past !== prev) runOnJS(setScrolled)(past);
    },
  );
  return scrolled;
}
