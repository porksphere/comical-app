import { use$ } from '@legendapp/state/react';

import {
  actionMatches,
  bindingsFor,
  chordFromEvent,
  KEY_ACTIONS,
  rebound,
  sameChord,
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

let capturing = false;

export function isKey(e: KeyEventLike, action: KeyAction): boolean {
  return !capturing && actionMatches(e, action, overrides$.peek());
}

/** The first of `actions` that `e` is bound to. */
export function keyActionOf<A extends KeyAction>(e: KeyEventLike, actions: readonly A[]): A | null {
  if (capturing) return null;
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

/**
 * Takes the next key press for Settings to bind, and no handler sees it: the keymap answers nothing
 * while this is waiting, and the capturing listener stops the press before the Escape listeners.
 * Escape cancels (`null`). Returns a cancel of its own.
 */
export function captureChord(done: (chord: KeyChord | null) => void): () => void {
  capturing = true;
  let waiting = true;
  const stop = () => {
    if (!waiting) return;
    waiting = capturing = false;
    window.removeEventListener('keydown', onKeyDown, true);
  };
  const finish = (chord: KeyChord | null) => {
    stop();
    done(chord);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.key === 'Escape') return finish(null);
    const chord = chordFromEvent(e);
    if (chord) finish(chord);
  };
  window.addEventListener('keydown', onKeyDown, true);
  return stop;
}

/** Binds `action` to `chord`, taking it from whichever actions had it. */
// Every write replaces the whole object: a child set mutates it in place, and whatever the React
// Compiler memoized on the old reference would never see the change.

export function setKeyBinding(action: KeyAction, chord: KeyChord, takeFrom: readonly KeyAction[] = []): void {
  const next = { ...overrides$.peek() };
  for (const other of takeFrom) next[other] = bindingsFor(other, next).filter((c) => !sameChord(c, chord));
  next[action] = rebound(action, chord);
  overrides$.set(next);
}

export function setKeyOverrides(overrides: KeyOverrides): void {
  overrides$.set(structuredClone(overrides));
}

export function resetKeyBinding(action: KeyAction): void {
  const next = { ...overrides$.peek() };
  delete next[action];
  overrides$.set(next);
}

export function resetAllKeyBindings(): void {
  overrides$.set({});
}

export { KEY_ACTIONS };
