import { useCallback, useEffect, useMemo } from 'react';
import { traceJS } from '@/lib/gesture-trace';
import { useRouter } from '@/lib/nav';
import { BACK_TARGET, msUntilClaimable } from '@/lib/nav-guard';

/** Instances that have already left. See `leaveOnce` for why this lives out here. */
const LEFT = new WeakSet<object>();

/** An instance's pop waiting out the back guard's window — see `routeBackHeld`. */
const HELD_POPS = new WeakMap<object, ReturnType<typeof setTimeout>>();

/**
 * Leaving a series page, the details or the reader. The modal ROOT pops the route (deep-linked or
 * full-page-loaded entries on web have no back stack — land on the browse tabs instead of
 * dead-ending); on a pushed card that pop IS the exit, the system's slide (useNativePush). A drilled
 * LAYER never touches navigation: it collapses on the same `zoom` a drag moves (closeLayer —
 * chevron/hardware back), or is removed outright once a gesture has already collapsed it or flown
 * the page out (`leaveOnce` — the parent series is live beneath).
 *
 * `inPane`: the desktop pane's details, which the router's double-back guard does not apply to.
 */
export function usePageLeave({
  depth,
  onPopLayer,
  inPane = false,
}: {
  depth: number;
  onPopLayer: () => void;
  inPane?: boolean;
}) {
  const router = useRouter();
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  /** This instance's key in the module-level latches (LEFT, HELD_POPS) — see `leaveOnce`. */
  const token = useMemo(() => ({}), []);
  // The router drops a second back inside its double-tap window (lib/nav-guard), and a dropped
  // pop at the END of an exit strands the page: gone from view, still on top, LEFT latched
  // against another try. Leaving the reader page for the details and then the details is two
  // backs in a row, so it is the common case, not a corner. A press asks first and does nothing
  // inside the window, like any other back in the app (closeLayer); a gesture has already moved
  // the page, so its pop waits the window out instead.
  const routeBackHeld = useCallback(() => depth === 0 && !inPane && msUntilClaimable(BACK_TARGET) > 0, [depth, inPane]);
  useEffect(() => () => clearTimeout(HELD_POPS.get(token)), [token]);
  const popRoute = useCallback(() => {
    const attempt = () => {
      const wait = inPane ? 0 : msUntilClaimable(BACK_TARGET);
      if (wait > 0) HELD_POPS.set(token, setTimeout(attempt, wait));
      else goBack();
    };
    attempt();
  }, [token, inPane, goBack]);
  const leaveNow = useCallback(() => {
    // Bracketed in the trace with the unmount below, so a recording measures the TEARDOWN — popping
    // the route, unmounting the page, un-blanking the source card — as its own span. It is the last
    // thing that happens on a collapse and the only thing left at that end of it; `frame LONG` lines
    // falling between these two say what it costs, which is the number any attempt to shrink it
    // would have to beat.
    traceJS('leave', 'start', { depth });
    if (depth > 0) onPopLayer();
    else popRoute();
  }, [depth, onPopLayer, popRoute]);
  useEffect(() => () => traceJS('leave', 'unmounted', { depth }), [depth]);
  // The other end of the page's life. Teardown measured 9-44ms and turned out not to be worth
  // attacking; this is the half that hasn't been measured, and it is the larger one — the whole
  // page mounts here while the entrance animation plays.
  useEffect(() => traceJS('open', 'mount', { depth }), [depth]);
  // EVERY exit animation ends here rather than calling `leaveNow` directly, because an animation
  // callback is not a promise that it ran: reanimated reports `finished: false` for a curve that
  // got interrupted, and an exit that reached its end state without leaving stranded the page —
  // mounted, invisible or shrunk, and still swallowing touches. So the exits fire this whether or
  // not the curve finished, AND arm a wall-clock backstop, and this makes the extra calls harmless.
  /**
   * …and this latch is what makes them harmless. It is a PLAIN JS BOX, and that is the fix for a
   * real bug rather than a style preference.
   *
   * It used to be a shared value, on the reasoning that the pan is built during render so nothing
   * its worklets reach may touch a React ref. True of the worklets — but `leaveOnce` is not one.
   * Every caller reaches it through `runOnJS`, so it only ever executes on the JS thread, where a
   * shared value is the wrong instrument: a `.set()` here is not guaranteed visible to a `.get()`
   * in the next JS task, because the value's home is the UI thread. So two exits firing off one
   * frame — the leave reaction and the collapse spring's completion, which by design both mean
   * "arrived" — each read the latch as false and each ran.
   *
   * A device trace caught it exactly:
   *
   *     leave start depth=2 / layer pop from=2 left=1
   *     leave start depth=2 / layer pop from=1 left=0
   *
   * One instance leaving, two pops — so dismissing a series drilled from a search layer took the
   * search layer with it and landed back on the series underneath. Only via the swipe, because the
   * chevron path has a single caller and never exercises the latch at all.
   *
   * Held in a module-level WeakSet keyed on a per-instance token, which is the one shape both lint
   * rules allow here: `useRef` is out because the pan is built during render, and mutating a
   * `useMemo` result is out too — so the memo hands out an identity and the mutation happens in the
   * set. Plain JS, one thread, no cross-runtime visibility to reason about.
   */
  const leaveOnce = useCallback(() => {
    if (LEFT.has(token)) return;
    LEFT.add(token);
    leaveNow();
  }, [token, leaveNow]);
  const hasLeft = useCallback(() => LEFT.has(token), [token]);
  return { goBack, routeBackHeld, leaveOnce, hasLeft };
}
