import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { isTypingTarget } from '@/lib/key-hold';
import { isKey } from '@/lib/keybindings';
import type { KeyAction } from '@/lib/keymap';

/**
 * A key from lib/keymap — web and the desktop shell only; a phone has no keyboard to bind. A chord
 * with Ctrl/⌘ answers even from inside a text field, the way Ctrl+K does in a browser; a bare one
 * would be typing.
 *
 * `focused` scopes it to the screen it is called from: tab screens stay mounted behind the active
 * one, so a Ctrl+F bound by every tab at once would answer from whichever registered last.
 */
export function useKeyboardShortcut(action: KeyAction, handler: () => void, { focused = false } = {}) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const listen = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (!isKey(e, action) || (!(e.ctrlKey || e.metaKey) && isTypingTarget(e.target))) return;
      e.preventDefault();
      handlerRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [action]);

  useEffect(() => (focused ? undefined : listen()), [focused, listen]);
  useFocusEffect(useCallback(() => (focused ? listen() : undefined), [focused, listen]));
}
