import { useEffect, useEffectEvent } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * The key that backs out of a popup — Escape on web and the desktop shell (whose mouse back button
 * arrives as one, see lib/desktop-commands), the hardware back button on Android.
 *
 * Only the most recently opened popup answers, and it CONSUMES the key: everything a popup can be
 * opened over — a series layer, the settings panel, a sheet — closes on Escape too, and used to
 * close along with it, or instead of it. So the listener is captured on the window, ahead of all of
 * those, and stops the event there.
 */
const stack: { current: () => void }[] = [];

function onKeyDown(e: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (e.key !== 'Escape' || !top) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  top.current();
}

export function useDismissKey(dismiss: () => void, enabled = true): void {
  const onDismiss = useEffectEvent(dismiss);
  useEffect(() => {
    if (!enabled) return;
    if (Platform.OS !== 'web') {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onDismiss();
        return true;
      });
      return () => sub.remove();
    }
    if (typeof window === 'undefined') return;
    const entry = { current: () => onDismiss() };
    stack.push(entry);
    if (stack.length === 1) window.addEventListener('keydown', onKeyDown, true);
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      if (stack.length === 0) window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled]);
}
