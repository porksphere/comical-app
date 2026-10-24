// Every key the desktop answers, in one table. The app is meant to be driven by one hand on the
// left of the keyboard — WASD under the fingers, Space under the thumb, Shift/Ctrl/Alt under the
// pinky — so no default here may need a key from the right-hand side. Arrows are kept as aliases
// for whoever does reach for them.
//
// Pure on purpose (no React Native, no storage): the bindings a user has changed live in
// lib/keybindings, which is what handlers read; this file is what they are checked against.

/** One key press. `key` is `KeyboardEvent.key`, lowercased ('w', ' ', 'escape', 'f1').
 *  Modifiers are EXACT — Shift+D is not D — so a chord with Shift can share a letter with one
 *  without. `mod` is Ctrl, or ⌘ on a Mac. */
export type KeyChord = { key: string; shift?: boolean; alt?: boolean; mod?: boolean };

/** Where an action is live. `global` keys are live on every screen and so collide with every
 *  scope; `lists` and `reader` are never on screen together, so they may reuse each other's keys. */
export type KeyScope = 'global' | 'lists' | 'reader';

export type KeyActionDef = {
  label: string;
  scope: KeyScope;
  keys: readonly KeyChord[];
  /** A note for the shortcuts sheet: what the key does beyond its label. */
  hint?: string;
  /** Not rebindable. */
  fixed?: boolean;
};

const k = (key: string, mods: Omit<KeyChord, 'key'> = {}): KeyChord => ({ key, ...mods });
/** A symbol that needs Shift on some layouts and not on others ('+' on US vs German). */
const anyShift = (key: string): KeyChord[] => [k(key), k(key, { shift: true })];

export const KEY_ACTIONS = {
  up: { label: 'Up', scope: 'global', keys: [k('w'), k('arrowup')], hint: 'Scrolls, pans a zoomed page, or moves the focus' },
  down: { label: 'Down', scope: 'global', keys: [k('s'), k('arrowdown')], hint: 'Scrolls, pans a zoomed page, or moves the focus' },
  left: { label: 'Left', scope: 'global', keys: [k('a'), k('arrowleft')], hint: 'Turns the page, or moves the focus; with nothing focused, focuses the rightmost thing at the top' },
  right: { label: 'Right', scope: 'global', keys: [k('d'), k('arrowright')], hint: 'Turns the page, or moves the focus; with nothing focused, focuses the leftmost thing at the top' },
  back: { label: 'Back', scope: 'global', keys: [k('a', { alt: true })] },
  forward: { label: 'Forward', scope: 'global', keys: [k('d', { alt: true })] },
  dismiss: {
    label: 'Close',
    scope: 'global',
    keys: [k('escape')],
    hint: 'Leaves a text field, then closes what is open, then lets go of the focus, then goes back',
    // Everything that closes listens for Escape itself, and the shell's mouse back button arrives
    // as a synthetic one (lib/desktop-commands).
    fixed: true,
  },
  search: { label: 'Search', scope: 'global', keys: [k('k', { mod: true })] },
  filter: { label: 'Filter this screen', scope: 'global', keys: [k('f', { mod: true })] },
  save: { label: 'Add to library', scope: 'global', keys: [k('f')], hint: 'In the reader, saves the page' },
  'tab-browse': { label: 'Go to Browse', scope: 'global', keys: [k('1')], hint: 'Again to step through the bridges' },
  'tab-library': { label: 'Go to Library', scope: 'global', keys: [k('2')], hint: 'Again to step through the collections' },
  'tab-history': { label: 'Go to History', scope: 'global', keys: [k('3')] },
  'tab-activity': { label: 'Go to Activity', scope: 'global', keys: [k('4')] },
  'tab-settings': { label: 'Go to Settings', scope: 'global', keys: [k('5')] },
  shortcuts: { label: 'Keyboard shortcuts', scope: 'global', keys: [k('f1')] },

  activate: { label: 'Open', scope: 'lists', keys: [k(' ')], hint: 'Presses what has the focus; with nothing focused, focuses the first thing on screen' },
  menu: { label: 'Menu', scope: 'lists', keys: [k('r')], hint: 'What a right-click or long press opens' },
  'scroll-up': { label: 'Scroll up', scope: 'lists', keys: [k('w', { shift: true })], hint: 'Even while something has the focus' },
  'scroll-down': { label: 'Scroll down', scope: 'lists', keys: [k('s', { shift: true })], hint: 'Even while something has the focus' },

  'page-next': { label: 'Next page', scope: 'reader', keys: [k(' ')], hint: 'Scrolls a screen first where there is more page' },
  'page-prev': { label: 'Previous page', scope: 'reader', keys: [k(' ', { shift: true })] },
  'chapter-next': { label: 'Next chapter', scope: 'reader', keys: [k('d', { shift: true })], hint: 'Swaps with Previous for right-to-left' },
  'chapter-prev': { label: 'Previous chapter', scope: 'reader', keys: [k('a', { shift: true })], hint: 'Swaps with Next for right-to-left' },
  'zoom-in': { label: 'Zoom in', scope: 'reader', keys: [k('e')], hint: 'Hold to keep zooming; press twice for all the way' },
  'zoom-out': { label: 'Zoom out', scope: 'reader', keys: [k('q')], hint: 'Hold to keep zooming; press twice for all the way' },
  'zoom-step-in': { label: 'Zoom in a step', scope: 'reader', keys: [...anyShift('+'), k('=')] },
  'zoom-step-out': { label: 'Zoom out a step', scope: 'reader', keys: [k('-'), ...anyShift('_')] },
  'zoom-reset': { label: 'Reset zoom', scope: 'reader', keys: [k('0')] },
  'switch-fit': { label: 'Switch fit', scope: 'reader', keys: [k('x')], hint: 'Fit the other side of the page' },
  'reader-controls': { label: 'Reader controls', scope: 'reader', keys: [k('tab')], hint: 'Shows the toolbar and focuses it' },
} as const satisfies Record<string, KeyActionDef>;

export type KeyAction = keyof typeof KEY_ACTIONS;

export const TAB_KEY_ACTIONS = ['tab-browse', 'tab-library', 'tab-history', 'tab-activity', 'tab-settings'] as const;

export const KEY_SCOPE_LABELS: Record<KeyScope, string> = {
  global: 'Everywhere',
  lists: 'Lists and screens',
  reader: 'Reader',
};

/** What a user has rebound. An action that isn't here keeps its defaults. */
export type KeyOverrides = Partial<Record<KeyAction, KeyChord[]>>;

/**
 * The defaults moved six columns right, for the right hand: WASD becomes IJKL and everything
 * around it moves with it. The digits only have room to move five (6–0), which takes 0 from Reset
 * zoom, so that one goes to H. Tab, Space, F1 and the Ctrl chords are kept: Tab is the browser's own
 * focus key, Space is under either thumb, and a Ctrl chord already has a Ctrl key on each side.
 */
export const MIRRORED_KEYS: KeyOverrides = {
  up: [k('i'), k('arrowup')],
  down: [k('k'), k('arrowdown')],
  left: [k('j'), k('arrowleft')],
  right: [k('l'), k('arrowright')],
  back: [k('j', { alt: true })],
  forward: [k('l', { alt: true })],
  save: [k(';')],
  'tab-browse': [k('6')],
  'tab-library': [k('7')],
  'tab-history': [k('8')],
  'tab-activity': [k('9')],
  'tab-settings': [k('0')],
  menu: [k('p')],
  'scroll-up': [k('i', { shift: true })],
  'scroll-down': [k('k', { shift: true })],
  'chapter-next': [k('l', { shift: true })],
  'chapter-prev': [k('j', { shift: true })],
  'zoom-in': [k('o')],
  'zoom-out': [k('u')],
  'zoom-reset': [k('h')],
  'switch-fit': [k(',')],
};

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>;

export function chordMatches(e: KeyEventLike, chord: KeyChord): boolean {
  return (
    e.key.toLowerCase() === chord.key &&
    e.shiftKey === !!chord.shift &&
    e.altKey === !!chord.alt &&
    (e.ctrlKey || e.metaKey) === !!chord.mod
  );
}

export function bindingsFor(action: KeyAction, overrides: KeyOverrides): readonly KeyChord[] {
  return overrides[action] ?? KEY_ACTIONS[action].keys;
}

export function actionMatches(e: KeyEventLike, action: KeyAction, overrides: KeyOverrides): boolean {
  return bindingsFor(action, overrides).some((c) => chordMatches(e, c));
}

/** The chord a key press makes, or null for a press of a modifier alone. */
export function chordFromEvent(e: KeyEventLike): KeyChord | null {
  const key = e.key.toLowerCase();
  if (key === 'shift' || key === 'control' || key === 'alt' || key === 'meta' || key === 'os') return null;
  const chord: KeyChord = { key };
  if (e.shiftKey) chord.shift = true;
  if (e.altKey) chord.alt = true;
  if (e.ctrlKey || e.metaKey) chord.mod = true;
  return chord;
}

export function sameChord(a: KeyChord, b: KeyChord): boolean {
  return a.key === b.key && !!a.shift === !!b.shift && !!a.alt === !!b.alt && !!a.mod === !!b.mod;
}

/** What a rebind to `chord` leaves `action` bound to: that, and the arrows it had as aliases. */
export function rebound(action: KeyAction, chord: KeyChord): KeyChord[] {
  const aliases = KEY_ACTIONS[action].keys.filter((c: KeyChord) => c.key.startsWith('arrow') && !sameChord(c, chord));
  return [chord, ...aliases];
}

const sameChords = (a: readonly KeyChord[], b: readonly KeyChord[]) =>
  a.length === b.length && a.every((c, i) => sameChord(c, b[i]!));

/** Whether `overrides` binds every action exactly as `preset` does. */
export function matchesPreset(overrides: KeyOverrides, preset: KeyOverrides): boolean {
  return (Object.keys(KEY_ACTIONS) as KeyAction[]).every((a) => sameChords(bindingsFor(a, overrides), bindingsFor(a, preset)));
}

const scopesMeet = (a: KeyScope, b: KeyScope) => a === b || a === 'global' || b === 'global';

/** The other actions `chord` would also trigger, were `action` bound to it. */
export function chordConflicts(action: KeyAction, chord: KeyChord, overrides: KeyOverrides): KeyAction[] {
  const scope = KEY_ACTIONS[action].scope;
  return (Object.keys(KEY_ACTIONS) as KeyAction[]).filter(
    (other) =>
      other !== action &&
      scopesMeet(scope, KEY_ACTIONS[other].scope) &&
      bindingsFor(other, overrides).some((c) => sameChord(c, chord)),
  );
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  tab: 'Tab',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
};

/** `mac` names the modifiers the way a Mac's keyboard does. */
export function chordLabel(chord: KeyChord, mac = false): string {
  const name = KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key.replace(/^./, (c) => c.toUpperCase()));
  const parts: string[] = [];
  if (chord.mod) parts.push(mac ? '⌘' : 'Ctrl');
  if (chord.alt) parts.push(mac ? '⌥' : 'Alt');
  if (chord.shift) parts.push(mac ? '⇧' : 'Shift');
  parts.push(name);
  return parts.join(mac ? '' : '+');
}
