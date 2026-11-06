import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';

/**
 * How far above the window's bottom edge a ROOT overlay (toast, request pill, the card context
 * menu) has to stay to clear the tab bar, the home indicator included.
 *
 * A root overlay's `insets.bottom` comes from the root provider, which knows nothing of the tab
 * bar. On Android and web the bar is our own overlay, `BottomTabInset` tall. On iOS it is UIKit's,
 * and where it sits is UIKit's call: along the bottom on a phone, beside the content in a
 * regular-width scene or iPhone Duo's vertical bar, gone under the reader. Each tab's own safe
 * area already says which — its bottom inset is the home indicator plus the bar wherever the bar
 * is along the bottom — so the focused tab reports that (`TabBarClearanceReporter`, rendered by
 * `tab-stack`) and the overlays read it here. Until a tab has, an iPhone's bar is assumed.
 *
 * Plain module state behind useSyncExternalStore, as `native-tab-bar` is: one number the overlays
 * render from, nothing persists it.
 */
const IPHONE_TAB_BAR = 49;

let reported: number | null = null;
const listeners = new Set<() => void>();

function report(bottom: number) {
  if (bottom === reported) return;
  reported = bottom;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number | null {
  return reported;
}

/** Reports the focused tab's bottom inset. Rendered once in each iOS tab, inside its safe area. */
export function TabBarClearanceReporter() {
  const { bottom } = useSafeAreaInsets();
  useFocusEffect(
    useCallback(() => {
      report(bottom);
    }, [bottom]),
  );
  return null;
}

export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  const tabBottom = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (Platform.OS !== 'ios') return BottomTabInset + insets.bottom;
  return Math.max(insets.bottom, tabBottom ?? insets.bottom + IPHONE_TAB_BAR);
}
