import { runOnJS, runOnUI, withTiming, type SharedValue } from 'react-native-reanimated';

import type { PushbackSignal } from '@/lib/pushback-watchdog';

/**
 * The Reanimated half of the pushback watchdog: one shared value, wrapped as something
 * `armSettleCheck` can read and put back. Split out of `pushback-watchdog` itself purely so that
 * module stays free of Reanimated and therefore loadable in a bun unit test — the same split, for
 * the same reason, as `tab-bar-slide` next to `tab-bar-visibility`.
 */
export function sharedPushback(value: SharedValue<number>): PushbackSignal {
  return {
    // Read on the UI thread, where the value actually lives. `seriesReaderDim` is written every
    // frame by a UI-thread reaction, and the JS-side copy of such a value can be arbitrarily stale
    // — reading it from here would answer a different question than the one being asked.
    read: (then) => {
      runOnUI(() => {
        'worklet';
        runOnJS(then)(value.value);
      })();
    },
    // Eased rather than snapped: a recovery lands on a screen someone is looking at, and one that
    // flicks reads as a second glitch on top of the one being recovered from.
    rest: () => {
      value.set(withTiming(0, { duration: 200 }));
    },
  };
}
