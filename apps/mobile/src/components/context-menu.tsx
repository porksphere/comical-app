/**
 * `Holdable`: the shared hold-to-open behaviour for rows inside scrolling lists. The menus a hold
 * opens are drawn by context-menu-host.tsx, on every platform.
 */
import { useMemo, type ReactNode } from 'react';
import { Platform, View, type GestureResponderEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import type { AnchorRect } from '@/components/overlay/overlay';

/**
 * The shared hold-to-open behavior, platform-split the same way the series card menu is:
 *
 *  - **native** — a gesture-handler `LongPress` wraps the content. NOT a `Pressable`'s
 *    `onLongPress`: inside a scrolling list on iOS that doesn't fire reliably (the touch is routed
 *    to the scroll view; see series-card-menu.tsx, which learned this first). GH recognizes the
 *    hold at the native layer, cancels the child's press responder when it fires, and any finger
 *    travel before the hold elapses loses to the scroll.
 *  - **web** — the child's own `onLongPress` (handed through the render prop), because RNW routes
 *    the release to whichever Pressable grabbed the touch — a wrapping gesture can't suppress the
 *    child's click, but RNW's Pressable suppresses its OWN press after its long-press fires.
 *
 * `onHold` receives the PRESS POINT as a zero-size anchor rect, so the menu can open as a popover
 * floating at the finger (the classic context-menu placement) instead of a bottom sheet.
 */
export function Holdable({
  enabled = true,
  onHold,
  children,
}: {
  enabled?: boolean;
  onHold: (anchor?: AnchorRect) => void;
  /** Render prop: spread `onLongPress` onto the row's own Pressable (it's undefined on native,
   *  where the wrapping gesture detects the hold instead). */
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void }) => ReactNode;
}) {
  // `runOnJS(true)`: the handler is a plain JS callback, so no worklet/ref plumbing. A changed
  // handler re-configures the recognizer in place (GestureDetector diffs), which is cheap.
  const gesture = useMemo(
    () =>
      Gesture.LongPress()
        // 500ms, matching UIKit's own UILongPressGestureRecognizer default. 350 was eager enough to
        // claim touches meant as taps: a deliberate, unhurried press on a card would open the menu
        // instead of the series. It also sat under the duration of an XCUITest-synthesized touch,
        // which is how e2e/mobile/browse-to-reader failed on iOS — the card tap registered (Maestro
        // saw the UI react) but the hold won it, so nothing navigated and `series.cover` never
        // appeared, while Android (`adb shell input tap`, ~50ms) was nowhere near the threshold.
        // Same class as the reader's single-tap bound, which had to move the other way for the same
        // reason (see use-zoomable's SINGLE_TAP_MAX_DURATION).
        .minDuration(500)
        .runOnJS(true)
        .enabled(enabled && Platform.OS !== 'web')
        .onStart((e) => onHold({ x: e.absoluteX, y: e.absoluteY, width: 0, height: 0 })),
    [enabled, onHold],
  );
  if (Platform.OS === 'web') {
    return (
      <>
        {children({
          onLongPress: enabled
            ? (e) => onHold({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0 })
            : undefined,
        })}
      </>
    );
  }
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false}>{children({})}</View>
    </GestureDetector>
  );
}
