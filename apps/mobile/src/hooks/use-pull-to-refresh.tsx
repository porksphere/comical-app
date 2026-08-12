import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, RefreshControl } from 'react-native';
import { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { useTouchPullToRefresh } from '@/hooks/use-touch-pull-to-refresh';

/**
 * Minimum time a triggered refresh keeps `refreshing` true, however fast the fetch resolves.
 *
 * A same-device fetch (the embedded transport, or just a warm cache) can resolve in a handful of ms —
 * far less than a pull-release-and-settle takes. Without this floor the spinner is told to stop
 * before it has even rendered, which reads as a flicker rather than a refresh. Owned here rather
 * than per-screen so no two screens can drift apart on it.
 */
const REFRESH_MIN_VISIBLE_MS = 600;

/** Native platforms take the real OS refresh control; only web falls back to the custom overlay. */
const USE_NATIVE_CONTROL = Platform.OS !== 'web';

/**
 * Lifts the iOS control above the list's cells while it's refreshing.
 *
 * UIKit adds `UIRefreshControl` as a BACK-most subview of the scroll view, which is invisible at its
 * default position because the only place it shows is the overscroll gap, where there's no content
 * to cover it. `progressViewOffset` moves it down into the content region (that's the whole point —
 * it has to clear the top bar), and there the cells draw straight over it.
 *
 * RN maps a view's `zIndex` onto the control's `layer.zPosition`
 * (`RCTPullToRefreshViewComponentView.mm`), which is exactly the lever for this.
 *
 * iOS-only: Android's control is a `SwipeRefreshLayout` that wraps the scroller and already draws
 * its circle above the child, so it needs no help and shouldn't have its draw order perturbed.
 */
const ABOVE_CONTENT = Platform.OS === 'ios' ? ({ zIndex: 1 } as const) : undefined;

/**
 * The whole pull-to-refresh story for a scrolling list, in one hook — everything a screen needs to
 * wire a spinner up to its own refetch.
 *
 * **The split is native control vs. web overlay.** iOS and Android both get RN's `RefreshControl`,
 * so each draws its own genuine OS affordance: `UIRefreshControl`'s spokes filling in determinately
 * under your finger on iOS, `SwipeRefreshLayout`'s circle on Android. Neither is imitated — they're
 * the real thing, including the gesture, so on native this hook contributes no gesture handling at
 * all beyond handing the control its `refreshing` flag.
 *
 * **Web is the exception, and it has no choice.** `react-native-web`'s `RefreshControl` is an inert
 * stub: it destructures `onRefresh`, `refreshing` and the rest, discards them, and renders a bare
 * `<View>` — so it would silently never fire. Web therefore keeps the hand-rolled path:
 * `useTouchPullToRefresh` for the gesture and `<PullIndicator>` for the spinner.
 *
 * That means the two paths need DIFFERENT wiring, and a screen supplies both sets unconditionally —
 * each is inert off its own platform:
 *
 *  - `refreshControl` → the list's `refreshControl` prop (undefined on web).
 *  - `touchHandlers` → spread on the screen's outer view (null on native). Catching raw touches
 *    there works regardless of what's under the finger.
 *  - `listStyle` → the list's wrapper, so the pulled-open gap opens (identity on native, where the
 *    control manages its own space).
 *  - `indicator` → spread into `<PullIndicator {...indicator} />`, which renders null off web.
 *
 * `progressViewOffset` is the one number both paths share: how far below the top of the list frame
 * the spinner should sit, which is the bar's resting bottom edge. It feeds the native control's
 * prop of the same name and the web overlay's `top`, so the spinner lands in the same place either
 * way and a screen states it once.
 *
 * `refresh` may close over query objects that change identity every render — it's held in a ref, so
 * the returned `onRefresh` stays stable and the touch hook doesn't resubscribe on every render.
 */
export function usePullToRefresh(
  scrollY: SharedValue<number>,
  refresh: () => Promise<unknown>,
  progressViewOffset = 0,
) {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const activeRef = useRef(false);
  const startedAtRef = useRef(0);

  // Latest refetch closure, synced in an effect (not assigned during render — that's a ref write in
  // render, which React can't guarantee). Only ever read from event handlers, so it's never stale.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  // Hold `refreshing` for a minimum window — see REFRESH_MIN_VISIBLE_MS.
  const finish = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const wait = Math.max(0, REFRESH_MIN_VISIBLE_MS - (Date.now() - startedAtRef.current));
    if (wait === 0) setRefreshing(false);
    else setTimeout(() => setRefreshing(false), wait);
  }, []);

  const onRefresh = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    startedAtRef.current = Date.now();
    setRefreshing(true);
    void refreshRef.current().finally(finish);
  }, [finish]);

  // Called unconditionally (hook rules), but only ever driven on web — its handlers are the sole
  // thing that moves `pullY`, and they're withheld on native, so it rests at 0 there and every
  // value derived from it below is inert.
  const touchPull = useTouchPullToRefresh(scrollY, onRefresh, refreshing);

  // Shifts the list down so the gap the web spinner sits in opens up. On native this stays at 0:
  // the OS control reserves and animates its own space above the content.
  const listStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: touchPull.listTranslateY.value }],
  }));

  return {
    refreshing,
    listStyle,
    /** Pass to the list's `refreshControl`. Undefined on web, where RN's control is a no-op stub. */
    refreshControl: USE_NATIVE_CONTROL ? (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        // Keeps the spinner drawn over the cells rather than under them — see ABOVE_CONTENT.
        style={ABOVE_CONTENT}
        // Sinks the spinner below the top bar. Without it the control draws at the very top of the
        // scroll view's frame — which, under these full-bleed lists, is behind the opaque bar.
        progressViewOffset={progressViewOffset}
        // iOS tints the spokes; Android colours the arc and the circle behind it.
        tintColor={theme.textSecondary}
        colors={[theme.accent]}
        progressBackgroundColor={theme.backgroundElement}
      />
    ) : undefined,
    /** Spread onto the screen's outer view. Null on native, where the control owns the gesture. */
    touchHandlers: USE_NATIVE_CONTROL
      ? null
      : { onTouchStart: touchPull.onTouchStart, onTouchMove: touchPull.onTouchMove, onTouchEnd: touchPull.onTouchEnd },
    /** Spread into `<PullIndicator {...indicator} />` — renders null off web. */
    indicator: {
      pullY: touchPull.pullY,
      pullThreshold: touchPull.pullThreshold,
      refreshing,
      top: progressViewOffset,
    },
  };
}
