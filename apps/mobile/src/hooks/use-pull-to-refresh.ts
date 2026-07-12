import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { REFRESH_MIN_VISIBLE_MS } from '@/components/pull-indicator';
import { useNativePullToRefresh } from '@/hooks/use-native-pull-to-refresh';
import { useTouchPullToRefresh } from '@/hooks/use-touch-pull-to-refresh';

/**
 * The whole pull-to-refresh story for a scrolling grid, in one hook — everything a screen needs to
 * wire the shared spinner up to its own refetch.
 *
 * The platform-specific gesture sourcing already lives in two hooks; this composes them with the
 * orchestration that used to be copy-pasted alongside (refresh state, the min-visible window, the
 * platform pick, the content shift), so Browse and Search share one implementation instead of two
 * drifting ones:
 *
 *  - Web + Android (`useTouchPullToRefresh`): touch-driven — neither has usable elastic overscroll
 *    (web's RefreshControl is inert; Android clamps to a glow).
 *  - iOS (`useNativePullToRefresh`): reads the native bounce directly. RN's RefreshControl is unusable
 *    here anyway (its spinner draws behind the top bar — see that hook).
 *
 * Both are inert off their platforms, so both are called unconditionally. We deliberately use no
 * native `RefreshControl` anywhere: one custom overlay beats the Material control looking different
 * on Android alone.
 *
 * `refresh` may close over query objects that change identity every render — it's held in a ref, so
 * the returned `onRefresh` stays stable and the gesture hooks don't resubscribe on every render.
 *
 * Spread `touchHandlers` on the screen's outer view (catching raw touches there works regardless of
 * what's under the finger), put `listStyle` on the list's wrapper so the pulled-open gap actually
 * opens, pass `onScrollEndDrag` to the list, and hand `indicator` to `<PullIndicator top={…} />`.
 */
export function usePullToRefresh(scrollY: SharedValue<number>, refresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const activeRef = useRef(false);
  const startedAtRef = useRef(0);

  // Latest refetch closure, synced in an effect (not assigned during render — that's a ref write in
  // render, which React can't guarantee). Only ever read from event handlers, so it's never stale.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  // Hold `refreshing` for a minimum window: a same-device/cached fetch can resolve in a few ms, and
  // clearing the flag mid-gesture snaps the content back instead of letting it settle. See
  // REFRESH_MIN_VISIBLE_MS.
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

  const touchPull = useTouchPullToRefresh(scrollY, onRefresh, refreshing);
  const nativePull = useNativePullToRefresh(scrollY, onRefresh, refreshing);
  const pull = Platform.OS === 'ios' ? nativePull : touchPull;

  // Shifts the list down so the gap the spinner sits in opens up. On web + Android this tracks the
  // pull the whole way; on iOS it stays 0 during the pull (the native bounce already moves the
  // content) and only engages during the hold, to keep it pinned while refreshing.
  const listStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pull.listTranslateY.value }],
  }));

  return {
    refreshing,
    listStyle,
    /** Spread onto the screen's outer view. Empty on iOS, which sources its pull from the bounce. */
    touchHandlers:
      Platform.OS === 'ios'
        ? null
        : { onTouchStart: touchPull.onTouchStart, onTouchMove: touchPull.onTouchMove, onTouchEnd: touchPull.onTouchEnd },
    /** Pass to the list. iOS-only: a release past the threshold triggers the refresh. */
    onScrollEndDrag: Platform.OS === 'ios' ? nativePull.onScrollEndDrag : undefined,
    /** Spread into `<PullIndicator {...indicator} top={…} />`. */
    indicator: { pullY: pull.pullY, pullThreshold: pull.pullThreshold, refreshing },
  };
}
