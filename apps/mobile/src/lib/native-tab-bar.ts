import { useNavigation } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { isNativeSheetUp } from '@/lib/native-overlay-sheets';

/**
 * Whether the iOS system tab bar is hidden — a count of the screens asking for that, for the same
 * reason `tab-bar-visibility` keeps a count: two series layers can both be on their pages, and a
 * flag would bring the bar back as soon as the first of them returned to its details. Only the
 * reader takes it. Every pushed PAGE keeps the bar, as the system apps do (a series page or a
 * search lives inside the tab's own stack — see `tab-stack`), and the reader is the one screen
 * that is full-bleed.
 *
 * Plain module state behind useSyncExternalStore rather than a Legend observable: one boolean the
 * tab shell renders from, nothing persists it, nothing on the UI thread reads it.
 */
let hides = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function hideNativeTabBar(): () => void {
  hides += 1;
  if (hides === 1) notify();
  // Idempotent: a release called twice must not drop somebody else's hide along with its own.
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hides -= 1;
    if (hides === 0) notify();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return hides > 0;
}

export function useNativeTabBarHidden(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Hides the iOS tab bar while the calling screen is the one on screen: what UIKit's
 * `hidesBottomBarWhenPushed` does, which neither react-native-screens nor expo-router exposes.
 *
 * Focus alone brought the bar back late. Focus moves when the navigation state does, and an
 * interactive swipe away commits that only once the finger lifts and the page has gone, so the
 * bar appeared after the screen beneath had settled. The bar comes back instead the moment a
 * transition away STARTS — a swipe, a back, a page pushed over this one — and UIKit's own
 * animation of it runs alongside. It does not track the finger the way the native property
 * would. A cancelled swipe takes the bar away again; react-native-screens reports that only to
 * the screen that was swiped, which is this one. A system overlay sheet blurs the screen too
 * (it is a route over the whole shell), and the bar stays down under one.
 */
export function useHidesNativeTabBar(): void {
  const navigation = useNavigation<TransitionNavigation>();
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let release: (() => void) | null = null;
    const hide = () => {
      release ??= hideNativeTabBar();
    };
    const show = () => {
      release?.();
      release = null;
    };
    if (navigation.isFocused()) hide();
    const offs = [
      navigation.addListener('focus', hide),
      navigation.addListener('blur', () => {
        if (!isNativeSheetUp()) show();
      }),
      navigation.addListener('transitionStart', (e) => {
        if (e.data.closing) show();
      }),
      navigation.addListener('gestureCancel', hide),
    ];
    return () => {
      offs.forEach((off) => off());
      show();
    };
  }, [navigation]);
}

type TransitionNavigation = {
  isFocused(): boolean;
  addListener(type: 'transitionStart', cb: (e: { data: { closing: boolean } }) => void): () => void;
  addListener(type: 'focus' | 'blur' | 'gestureCancel', cb: () => void): () => void;
};
