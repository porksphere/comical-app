import { use$ } from '@legendapp/state/react';

import {
  actionMatches,
  bindingsFor,
  KEY_ACTIONS,
  type KeyAction,
  type KeyChord,
  type KeyOverrides,
} from '@/lib/keymap';
import { persisted$ } from '@/lib/observable';

// The keymap as the user has it: lib/keymap's defaults, with whatever they've rebound in Settings
// on top. Handlers read it at the moment of the key press (`isKey`), never through a subscription,
// so a rebind takes effect on the next press with nothing to re-register.

const overrides$ = persisted$<KeyOverrides>('comical:keyOverrides', {});

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>;

export function isKey(e: KeyEventLike, action: KeyAction): boolean {
  return actionMatches(e, action, overrides$.peek());
}

/** The first of `actions` that `e` is bound to. */
export function keyActionOf<A extends KeyAction>(e: KeyEventLike, actions: readonly A[]): A | null {
  const overrides = overrides$.peek();
  return actions.find((a) => actionMatches(e, a, overrides)) ?? null;
}

const MOVES = ['up', 'down', 'left', 'right'] as const;
const MOVE_DIRECTION = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const;

/** The direction a press of Up/Down/Left/Right moves in, or null for any other key. */
export function moveDirectionOf(e: KeyEventLike): { x: -1 | 0 | 1; y: -1 | 0 | 1 } | null {
  const move = keyActionOf(e, MOVES);
  return move ? MOVE_DIRECTION[move] : null;
}

let readers = 0;

/** A reader has the keys: the `lists` scope stands down until the returned release. */
export function claimReaderScope(): () => void {
  readers += 1;
  return () => {
    readers -= 1;
  };
}

export function readerScopeActive(): boolean {
  return readers > 0;
}

export function useKeyOverrides(): KeyOverrides {
  return use$(overrides$);
}

export function useKeyBindings(action: KeyAction): readonly KeyChord[] {
  return bindingsFor(action, useKeyOverrides());
}

export function setKeyBinding(action: KeyAction, keys: KeyChord[]): void {
  overrides$[action].set(keys);
}

export function resetKeyBinding(action: KeyAction): void {
  overrides$[action].delete();
}

export function resetAllKeyBindings(): void {
  overrides$.set({});
}

export { KEY_ACTIONS };
