import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import Animated, { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { ZOOM_OUT_BACKSTOP_MS } from '@/components/series/page-motion';

/**
 * The zoom mask, plus the one thing that has to know an exit started: it stops taking touches, so a
 * page on its way out can't be tapped, and a half-faded one can't eat a tap meant for the grid
 * behind it.
 *
 * Its OWN component purely so that knowledge costs its own render and not the whole page's. The
 * flag used to be state in the series page, flipped from inside the commit — which re-rendered
 * everything on the frame the collapse started. Here the reaction runs on the
 * UI thread, the setState lands in a component whose subtree is `children` — stable elements the
 * parent already built — so React re-renders this wrapper and reconciles nothing beneath it.
 */
export function LeavingMask({
  committing,
  leave,
  style,
  children,
}: {
  committing: SharedValue<boolean>;
  /** The instance's `leaveOnce`, for the backstop below. */
  leave: () => void;
  /** Whatever `Animated.View` takes — this forwards the zoom's animated mask style untouched. */
  style: ComponentProps<typeof Animated.View>['style'];
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  // `edgeCommitting` is the one-way "this instance is exiting" latch every exit sets — the chevron,
  // hardware back, the reader's dismiss fling and the details back-swipe alike — so watching it here
  // covers all four without any of them having to call anything.
  useAnimatedReaction(
    () => committing.value,
    (exiting, was) => {
      if (exiting && !was) runOnJS(setLeaving)(true);
    },
  );
  // The wall-clock backstop: a collapse that never arrives still leaves. Lives here rather than in
  // the instance because arming it there meant either a re-render (the stutter) or a ref the pan's
  // worklets could reach, which this file rules out for good reasons elsewhere.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(leave, ZOOM_OUT_BACKSTOP_MS);
    return () => clearTimeout(t);
  }, [leaving, leave]);
  return (
    <Animated.View style={style} pointerEvents={leaving ? 'none' : 'auto'}>
      {children}
    </Animated.View>
  );
}
