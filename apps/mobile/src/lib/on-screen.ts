import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

import { isNativeSheetUp } from '@/lib/native-overlay-sheets';

/**
 * Holds something for exactly as long as the calling screen is the one on screen: `take` runs as
 * it arrives and the release it returns runs as it goes.
 *
 * Focus alone gave it back late. Focus moves when the navigation state does, and an interactive
 * swipe away commits that only once the finger lifts and the page has gone, so whatever the screen
 * held came back after the screen beneath had settled. The release runs instead the moment a
 * transition away STARTS — a swipe, a back, a page pushed over this one — so the system's own
 * animation of what comes back runs alongside. A cancelled swipe takes it again;
 * react-native-screens reports that only to the screen that was swiped, which is this one. A
 * system overlay sheet blurs the screen too (it is a route over the whole shell), and the screen
 * keeps what it holds under one.
 */
export function useWhileOnScreen(take: () => () => void, enabled = true): void {
  const navigation = useNavigation<TransitionNavigation>();
  useEffect(() => {
    if (!enabled) return;
    let release: (() => void) | null = null;
    const hold = () => {
      release ??= take();
    };
    const letGo = () => {
      release?.();
      release = null;
    };
    if (navigation.isFocused()) hold();
    const offs = [
      navigation.addListener('focus', hold),
      navigation.addListener('blur', () => {
        if (!isNativeSheetUp()) letGo();
      }),
      navigation.addListener('transitionStart', (e) => {
        if (e.data.closing) letGo();
      }),
      navigation.addListener('gestureCancel', hold),
    ];
    return () => {
      offs.forEach((off) => off());
      letGo();
    };
  }, [navigation, take, enabled]);
}

type TransitionNavigation = {
  isFocused(): boolean;
  addListener(type: 'transitionStart', cb: (e: { data: { closing: boolean } }) => void): () => void;
  addListener(type: 'focus' | 'blur' | 'gestureCancel', cb: () => void): () => void;
};
