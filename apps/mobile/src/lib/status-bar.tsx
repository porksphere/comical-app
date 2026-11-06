import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { useWhileOnScreen } from '@/lib/on-screen';

/**
 * The status bar: the glyphs' colour, and whether it shows at all.
 *
 * On iOS it belongs to the view controllers. A build against the iOS 27 SDK ignores the app-wide
 * status bar calls, which are all React Native's StatusBar (and so expo-status-bar's) ever makes,
 * so the app runs with view-controller-based appearance (app.json) and sets the bar through
 * react-native-screens' screen options. iOS starts at the window's root stack, and
 * react-native-screens looks no further than the system tab bar controller, or any modal that is
 * not full screen, so whatever is showing, a ROOT screen answers: the root layout puts the options
 * on every one of them (`useRootStatusBarOptions`), and a screen further down asks it for what it
 * wants here. That is also the only call that reaches the status bar inside the side bar of an
 * iPhone Duo. React Native's StatusBar must not be mounted on iOS at all: under this appearance it
 * reports an error on every update.
 *
 * Elsewhere `ScreenStatusBar` is expo-status-bar's, and the most recently mounted one wins.
 */
export type StatusBarRequest = { style: 'light' | 'dark'; hidden: boolean };

const requests = new Map<string, StatusBarRequest>();
let current: StatusBarRequest | null = null;
const listeners = new Set<() => void>();

function publish() {
  // A Map keeps the order keys were first set in, so the screen that arrived last wins.
  let last: StatusBarRequest | null = null;
  for (const request of requests.values()) last = request;
  if (last === current) return;
  current = last;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): StatusBarRequest | null {
  return current;
}

/** The root stack's status bar options on iOS: the request on screen, else the theme's glyphs. */
export function useRootStatusBarOptions(scheme: 'light' | 'dark') {
  const request = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (Platform.OS !== 'ios') return undefined;
  return {
    statusBarStyle: request?.style ?? (scheme === 'dark' ? 'light' : 'dark'),
    statusBarHidden: request?.hidden ?? false,
    statusBarAnimation: 'fade',
  } as const;
}

function IosScreenStatusBar({ style, hidden }: StatusBarRequest) {
  const id = useId();
  const latest = useRef<StatusBarRequest>({ style, hidden });
  useEffect(() => {
    latest.current = { style, hidden };
    if (!requests.has(id)) return;
    requests.set(id, latest.current);
    publish();
  }, [id, style, hidden]);
  const take = useCallback(() => {
    requests.set(id, latest.current);
    publish();
    return () => {
      requests.delete(id);
      publish();
    };
  }, [id]);
  useWhileOnScreen(take);
  return null;
}

/** The status bar the calling screen wants while it is the one on screen. */
export const ScreenStatusBar: (props: StatusBarRequest) => ReactNode =
  Platform.OS === 'ios' ? IosScreenStatusBar : StatusBar;
