import { describe, expect, test } from 'bun:test';

import {
  actionMatches,
  chordConflicts,
  chordFromEvent,
  chordLabel,
  KEY_ACTIONS,
  matchesPreset,
  MIRRORED_KEYS,
  rebound,
  type KeyAction,
  type KeyChord,
} from './keymap';

const press = (key: string, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean } = {}) => ({
  key,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
});

const RIGHT_HAND_KEYS = new Set(['enter', 'backspace', 'delete', 'pageup', 'pagedown', 'home', 'end', '/', '?', 'f11']);

describe('actionMatches', () => {
  test('modifiers are exact, so Shift+D is a chapter and D a page', () => {
    expect(actionMatches(press('d'), 'right', {})).toBe(true);
    expect(actionMatches(press('D', { shift: true }), 'right', {})).toBe(false);
    expect(actionMatches(press('D', { shift: true }), 'chapter-next', {})).toBe(true);
    expect(actionMatches(press('d', { alt: true }), 'forward', {})).toBe(true);
    expect(actionMatches(press('d', { alt: true }), 'right', {})).toBe(false);
  });

  test('Caps Lock does not change the letter', () => {
    expect(actionMatches(press('F'), 'save', {})).toBe(true);
  });

  test('Ctrl and ⌘ are the same modifier', () => {
    expect(actionMatches(press('k', { ctrl: true }), 'search', {})).toBe(true);
    expect(actionMatches(press('k', { meta: true }), 'search', {})).toBe(true);
  });

  test('a symbol matches with or without the Shift its layout needs', () => {
    expect(actionMatches(press('+', { shift: true }), 'zoom-step-in', {})).toBe(true);
    expect(actionMatches(press('+'), 'zoom-step-in', {})).toBe(true);
    expect(actionMatches(press('=', { shift: true }), 'zoom-step-in', {})).toBe(false);
  });

  test('an override replaces the defaults', () => {
    const overrides = { save: [{ key: 'g' }] };
    expect(actionMatches(press('g'), 'save', overrides)).toBe(true);
    expect(actionMatches(press('f'), 'save', overrides)).toBe(false);
  });
});

describe('defaults', () => {
  test('every default is a left-hand key (arrows excepted, as aliases)', () => {
    for (const [action, def] of Object.entries(KEY_ACTIONS)) {
      const leftHand = def.keys.filter((c: KeyChord) => !c.key.startsWith('arrow'));
      expect({ action, keys: leftHand.filter((c: KeyChord) => RIGHT_HAND_KEYS.has(c.key)) }).toEqual({ action, keys: [] });
      expect({ action, count: leftHand.length > 0 }).toEqual({ action, count: true });
    }
  });

  test('no two actions that can be live together share a default', () => {
    for (const action of Object.keys(KEY_ACTIONS) as KeyAction[]) {
      for (const chord of KEY_ACTIONS[action].keys) {
        expect({ action, chord, with: chordConflicts(action, chord, {}) }).toEqual({ action, chord, with: [] });
      }
    }
  });

  test('the reader and the lists may share a key', () => {
    expect(chordConflicts('activate', { key: ' ' }, {})).toEqual([]);
    expect(chordConflicts('menu', { key: 'x' }, {})).toEqual([]);
    expect(chordConflicts('menu', { key: 'f' }, {})).toEqual(['save']);
  });
});

describe('rebinding', () => {
  test('a rebind keeps the arrow it had as an alias', () => {
    expect(rebound('up', { key: 'i' })).toEqual([{ key: 'i' }, { key: 'arrowup' }]);
    expect(rebound('up', { key: 'arrowup' })).toEqual([{ key: 'arrowup' }]);
    expect(rebound('save', { key: 'g' })).toEqual([{ key: 'g' }]);
  });

  test('the mirrored layout has no clashes of its own', () => {
    for (const action of Object.keys(KEY_ACTIONS) as KeyAction[]) {
      for (const chord of MIRRORED_KEYS[action] ?? KEY_ACTIONS[action].keys) {
        expect({ action, chord, with: chordConflicts(action, chord, MIRRORED_KEYS) }).toEqual({ action, chord, with: [] });
      }
    }
  });

  test('a layout is recognised however it was arrived at', () => {
    expect(matchesPreset({}, {})).toBe(true);
    expect(matchesPreset({ save: [{ key: 'f' }] }, {})).toBe(true);
    expect(matchesPreset({ ...MIRRORED_KEYS }, MIRRORED_KEYS)).toBe(true);
    expect(matchesPreset({ ...MIRRORED_KEYS, save: [{ key: 'g' }] }, MIRRORED_KEYS)).toBe(false);
    expect(matchesPreset({}, MIRRORED_KEYS)).toBe(false);
  });
});

describe('chordFromEvent / chordLabel', () => {
  test('a modifier alone is not a chord', () => {
    expect(chordFromEvent(press('Shift', { shift: true }))).toBeNull();
  });

  test('reads back what was pressed', () => {
    expect(chordFromEvent(press('A', { shift: true, alt: true }))).toEqual({ key: 'a', shift: true, alt: true });
    expect(chordLabel({ key: 'a', shift: true, alt: true })).toBe('Alt+Shift+A');
    expect(chordLabel({ key: ' ', shift: true })).toBe('Shift+Space');
    expect(chordLabel({ key: 'k', mod: true }, true)).toBe('⌘K');
    expect(chordLabel({ key: 'f1' })).toBe('F1');
  });
});
