import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import type { SeriesEntry } from '@/data/types';
import {
  commitHoveredRow,
  HOLD_ARM_DISTANCE,
  holdActive,
  holdArmed,
  holdX,
  holdY,
  hoveredRow,
  openSeriesCardMenu,
} from '@/lib/series-card-menu';

/**
 * Native (iOS + Android) per-card quick-actions menu. A long-press anywhere on the card opens the
 * iOS / X-style hold-down menu — a dimmed backdrop, the card lifted as a preview, and a rounded menu
 * springing in (rendered by the root `SeriesCardContextMenuHost`, driven by `openSeriesCardMenu`).
 * Web has its own affordance (a hover 3-dot button), in the `.web.tsx` file.
 *
 * The long-press is detected with `react-native-gesture-handler` (not a `Pressable`'s `onLongPress`):
 * inside a scrolling list on iOS the Pressable's `onLongPress` doesn't fire reliably — the touch is
 * routed to the scroll view — so the card reacted to the press (held state) but nothing opened. A GH
 * `LongPress` gesture recognizes the hold at the native layer and coexists with the card's tap
 * (navigation) and the list's scroll: a quick tap still navigates; moving the finger cancels it.
 *
 * There is NO per-card native context-menu host (the old SwiftUI `.ios.tsx` was the iOS scroll-jank
 * cause). Scrolling cards cost nothing; the menu is built on demand, once, on press.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), the card renders with no menu. */
  enabled: boolean;
  bridgeId?: string;
  /** Bridge display name — carried so a tapped tag in the preview can drive a Browse search. */
  bridge?: string;
  entry: SeriesEntry;
  /** Whether the bridge serves direct (page-thumbnail) series — the preview shows a page rail. */
  direct?: boolean;
  /** Cover aspect ratio, so the lifted preview matches the card's shape. */
  coverAspect?: number;
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void }) => React.ReactNode;
};

export function SeriesCardMenu({ enabled, bridgeId, bridge, entry, direct, coverAspect, children }: SeriesCardMenuProps) {
  const anchorRef = useRef<View>(null);
  // Where the hold began — the arming distance is measured from here (see `holdArmed`). Shared values,
  // because the gesture's worklets are the only thing that reads or writes them.
  const holdOriginX = useSharedValue(0);
  const holdOriginY = useSharedValue(0);
  // Hide THIS card while its menu is open so it doesn't show in the grid behind the lifted preview.
  // Local state → only this card re-renders (twice: open, close); no global store, nothing added to
  // any other card's scroll path. The menu carries `onClose` to flip it back.
  const [hidden, setHidden] = useState(false);
  // Open immediately from the long-press point so the menu ALWAYS appears, then best-effort refine to
  // the card's measured rect (host re-renders in place, same entry key → preview snaps to the card).
  const openMenuAt = useCallback(
    (absoluteX: number, absoluteY: number) => {
      if (!bridgeId) return;
      setHidden(true);
      const onClose = () => setHidden(false);
      openSeriesCardMenu({
        entry,
        bridgeId,
        bridge,
        direct,
        coverAspect,
        rect: { x: absoluteX - 80, y: absoluteY - 110, width: 160, height: 220 },
        onClose,
      });
      anchorRef.current?.measureInWindow?.((x, y, width, height) => {
        if (width > 0 && height > 0) {
          openSeriesCardMenu({ entry, bridgeId, bridge, direct, coverAspect, rect: { x, y, width, height }, onClose });
        }
      });
    },
    [bridgeId, bridge, entry, direct, coverAspect],
  );

  // A PAN that only activates after a hold — not a LongPress. The difference is the whole peek-and-
  // commit behaviour: a LongPress with `maxDistance(20)` cancels itself the moment the finger travels,
  // which is exactly what you do next when you slide onto a menu row. `activateAfterLongPress` gives
  // the same "hold, don't scroll" contract (movement before the hold elapses loses to the list's
  // scroll, so it still never fires mid-scroll) while keeping the finger AFTER it fires — so the same
  // uninterrupted touch that opened the menu can then pick from it.
  //
  // The touch can only ever belong to this gesture: the popup is a root overlay that mounts mid-touch,
  // and no touch system hands an in-flight gesture to a view that didn't exist when it began. So this
  // card reports the finger, and the popup reads it (see `holdActive`/`holdX`/`holdY`).
  const longPress = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(350)
        .enabled(enabled && !!bridgeId)
        .onStart((e) => {
          holdActive.value = true;
          // Dormant until the finger travels — see `holdArmed`. A hold you never moved selects nothing,
          // so opening the menu just to look at it and letting go can't run an action by accident.
          holdArmed.value = false;
          holdOriginX.value = e.absoluteX;
          holdOriginY.value = e.absoluteY;
          holdX.value = e.absoluteX;
          holdY.value = e.absoluteY;
          hoveredRow.value = -1;
          runOnJS(openMenuAt)(e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          // Keep reporting while the finger is still down; the popup hit-tests its rows against this.
          holdX.value = e.absoluteX;
          holdY.value = e.absoluteY;
          if (!holdArmed.value) {
            const dx = e.absoluteX - holdOriginX.value;
            const dy = e.absoluteY - holdOriginY.value;
            // Latches on: past this point jitter can't disarm you mid-pick.
            if (Math.hypot(dx, dy) > HOLD_ARM_DISTANCE) holdArmed.value = true;
          }
        })
        .onEnd(() => {
          // Lift = commit whatever the finger was over. Nothing under it (you never moved, or you slid
          // off) simply leaves the menu open, which is what the iOS one does.
          const row = hoveredRow.value;
          holdActive.value = false;
          holdArmed.value = false;
          hoveredRow.value = -1;
          if (row >= 0) runOnJS(commitHoveredRow)(row);
        })
        .onFinalize(() => {
          // Cancelled rather than ended (an interrupting touch, a navigation): drop the hold, don't
          // run anything.
          holdActive.value = false;
          holdArmed.value = false;
          hoveredRow.value = -1;
        }),
    [enabled, bridgeId, openMenuAt, holdOriginX, holdOriginY],
  );

  return (
    <GestureDetector gesture={longPress}>
      {/* collapsable={false} so the view stays measurable (for refining to the card's rect). Hidden
          (opacity 0, layout preserved) while its menu is open. */}
      <View ref={anchorRef} collapsable={false} style={hidden ? styles.hidden : undefined}>
        {children({ onLongPress: undefined })}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
});
