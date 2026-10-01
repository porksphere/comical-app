import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Ctrl+`key` (⌘ on a Mac) — web and the desktop shell only; a phone has no keyboard to bind.
 *
 * `focused` scopes it to the screen it is called from: tab screens stay mounted behind the active
 * one, so a Ctrl+F bound by every tab at once would answer from whichever registered last.
 */
export function useKeyboardShortcut(key: string, handler: () => void, { focused = false } = {}) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const listen = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== key) return;
      e.preventDefault();
      handlerRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [key]);

  useEffect(() => (focused ? undefined : listen()), [focused, listen]);
  useFocusEffect(useCallback(() => (focused ? listen() : undefined), [focused, listen]));
}
