import { useEffect } from 'react';

/**
 * Run an effect ONCE, on mount, with whatever it captured at mount — and no dependency array to
 * argue with.
 *
 * The pattern isn't new; what this hook buys is WHERE the suppression lives. `react-hooks`
 * suppressions are not local to the line they sit on: the React Compiler skips optimizing any
 * function that contains one, silently and without a diagnostic, so a mount-only effect written
 * inline costs its whole component the compiler's memoization — every child element rebuilt on
 * every render, however unrelated the state that caused it. Written this way the cost is bounded
 * to these three lines, and the component around it still compiles.
 *
 * Only for an effect whose inputs genuinely cannot change for the life of the mount (an entrance
 * animation's source rect, a seeded start position). Anything that CAN change wants a real
 * dependency array — a mount-only effect over a moving value is a stale closure, and this hook
 * hides that as effectively as the inline suppression did.
 */
export function useMountEffect(run: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by contract; see above.
  useEffect(run, []);
}
