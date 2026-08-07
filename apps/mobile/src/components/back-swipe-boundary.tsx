import type { ReactElement } from 'react';
import { GestureDetector } from 'react-native-gesture-handler';

import { useBackSwipeBlocker } from '@/lib/back-swipe';

/**
 * Wrap a HORIZONTAL scroller in this and the surrounding back-swipe will wait for it.
 *
 * The back-swipe and a rail scrolled rightward are the same drag — the only thing separating them
 * is which view the finger landed on, and the rail's own recognizer is the one that knows. So the
 * rail is given first refusal: it takes the drag when it has somewhere to scroll, and fails (letting
 * the back-swipe through) when it doesn't. See lib/back-swipe's note on the relation.
 *
 * Renders its child untouched where there is no back-swipe to yield to — the home feed's rails
 * mount the same component and get no extra recognizer at all.
 */
export function BackSwipeBoundary({ children }: { children: ReactElement }) {
  const blocker = useBackSwipeBlocker();
  if (!blocker) return children;
  return <GestureDetector gesture={blocker}>{children}</GestureDetector>;
}
