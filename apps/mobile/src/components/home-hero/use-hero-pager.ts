import { useEffect, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, runOnJS, useAnimatedReaction, useReducedMotion, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { createTickHaptic, hapticSelection } from '@/lib/haptics';
import { draggedPosition, keptFront, restingPosition } from '@/lib/home-hero';

const SPRING = { damping: 28, stiffness: 260, mass: 1 } as const;

/** How long after a drag ends a press still belongs to it. A browser sends the click a mouse drag
 *  ends in to whatever is under the pointer, before the drag has heard of its own end or after,
 *  and it opened the series the drag had just brought forward. */
const DRAG_TAIL_MS = 250;

export type HeroPager = {
  /** The series in front, by its place among `keys`. */
  index: number;
  /** Where the hero is along its series, part way between two while it moves. */
  position: SharedValue<number>;
  pan: ReturnType<typeof Gesture.Pan>;
  goTo: (index: number) => void;
  /** Whether a press that has just landed is a tap, and not the end of a drag. */
  tapped: () => boolean;
};

/**
 * Which of a hero's series is in front, and the drag that changes it: sideways only, so a drag
 * that starts up or down is the feed's. The position runs on the UI thread and what is drawn
 * follows it there; `index` is the nearest series, for the words and the dots.
 *
 * `opens` is where a set of series opens, `pitch` a finger's travel for one series, and `reach` how
 * many a single flick may pass.
 */
export function useHeroPager({ keys, opens, pitch, reach }: { keys: readonly string[]; opens: number; pitch: number; reach: number }): HeroPager {
  const count = keys.length;
  const [front, setFront] = useState(() => ({ keys, ...keptFront({ keys: [], index: 0, moved: false }, keys, opens) }));
  // Where a new set of series puts the hero: an object, so that the same place twice is still news.
  const [placed, setPlaced] = useState(() => ({ index: front.index }));
  if (front.keys !== keys) {
    const next = keptFront(front, keys, opens);
    setFront({ keys, ...next });
    setPlaced({ index: next.index });
  }
  const position = useSharedValue(front.index);
  const grabbedAt = useSharedValue(0);
  const from = useSharedValue(0);
  const byHand = useSharedValue(false);
  const dragging = useSharedValue(false);
  const draggedAt = useSharedValue(0);
  const still = useReducedMotion();
  const [tick] = useState(() => createTickHaptic(hapticSelection));

  useEffect(() => {
    cancelAnimation(position);
    byHand.set(false);
    position.set(placed.index);
  }, [placed, position, byHand]);

  const onFront = (index: number, hand: boolean) => {
    setFront((was) => (was.index === index && (was.moved || !hand) ? was : { ...was, index, moved: was.moved || hand }));
    // A series the reader brought forward clicks into place; the one the hero opens on does not.
    if (hand) tick();
  };
  useAnimatedReaction(
    () => Math.min(Math.max(0, count - 1), Math.max(0, Math.round(position.get()))),
    (now, was) => {
      if (was !== null && now !== was) runOnJS(onFront)(now, byHand.get());
    },
  );

  const pan = Gesture.Pan()
    .enabled(count > 1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onStart(() => {
      cancelAnimation(position);
      byHand.set(true);
      dragging.set(true);
      grabbedAt.set(position.get());
      from.set(Math.round(position.get()));
    })
    .onUpdate((e) => {
      position.set(draggedPosition(grabbedAt.get() - e.translationX / pitch, count));
    })
    .onEnd((e) => {
      const rest = restingPosition({ from: from.get(), position: position.get(), velocity: -e.velocityX / pitch, count, reach });
      position.set(still ? rest : withSpring(rest, SPRING));
    })
    .onFinalize(() => {
      if (!dragging.get()) return;
      dragging.set(false);
      // eslint-disable-next-line react-hooks/purity -- the pan's own callback, run as a drag ends and never during render; the clock is what a press is then told from the drag by.
      draggedAt.set(Date.now());
    });

  const goTo = (index: number) => {
    const to = Math.min(Math.max(0, count - 1), Math.max(0, index));
    byHand.set(true);
    position.set(still ? to : withSpring(to, SPRING));
  };

  const tapped = () => !dragging.get() && Date.now() - draggedAt.get() > DRAG_TAIL_MS;

  return { index: Math.min(front.index, Math.max(0, count - 1)), position, pan, goTo, tapped };
}
