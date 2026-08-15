import { type RefObject, useCallback, useMemo, useRef, useState } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import type { SeriesEntry } from '@/data/types';
import type { ZoomSourceKey } from '@/lib/series-zoom';
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
  /** Corner radius the lifted preview STARTS at, to match the source it lifts from (a thumbnail with a
   *  smaller radius than a card cover). Defaults to 10 — see `SeriesCardMenuRequest.startRadius`. */
  startRadius?: number;
  /** Measure THIS element for the lifted-preview rect instead of the wrapped content. For a row whose
   *  tappable area is wide but whose "card" is a small thumbnail (History), point it at the thumbnail so
   *  the preview lifts from there — otherwise the wide row rect makes the flying cover start huge. */
  measureRef?: RefObject<View | null>;
  /** This card's zoom-source key — forwarded so a navigating row's zoom blanks this card alone
   *  (see `SeriesCardMenuRequest.zoomSource`). Omitted on web, which has no zoom entrance. */
  zoomSource?: ZoomSourceKey;
  /** `hidden` is true while THIS card's menu is open — the child should hide just its COVER/thumbnail
   *  (so the lifted preview isn't doubled), NOT the whole item; the rest stays visible under the dim. */
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void; hidden: boolean }) => React.ReactNode;
};

export function SeriesCardMenu({ enabled, bridgeId, bridge, entry, direct, coverAspect, startRadius, measureRef, zoomSource, children }: SeriesCardMenuProps) {
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
        startRadius,
        zoomSource,
        rect: { x: absoluteX - 80, y: absoluteY - 110, width: 160, height: 220 },
        onClose,
      });
      // Prefer an explicit `measureRef` (e.g. History's thumbnail) so the preview lifts from a small
      // portrait rect, not the wide row that wraps the gesture.
      (measureRef?.current ?? anchorRef.current)?.measureInWindow?.((x, y, width, height) => {
        if (width > 0 && height > 0) {
          openSeriesCardMenu({ entry, bridgeId, bridge, direct, coverAspect, startRadius, zoomSource, rect: { x, y, width, height }, onClose });
        }
      });
    },
    [bridgeId, bridge, entry, direct, coverAspect, startRadius, zoomSource, measureRef],
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
        // eslint-disable-next-line react-hooks/refs -- the handler reads refs (via openMenuAt) only when a real hold fires, long after this render commits; the compiler can't see that a gesture callback isn't called during render.
        .onStart((e) => {
          holdActive.set(true);
          // Dormant until the finger travels — see `holdArmed`. A hold you never moved selects nothing,
          // so opening the menu just to look at it and letting go can't run an action by accident.
          holdArmed.set(false);
          holdOriginX.set(e.absoluteX);
          holdOriginY.set(e.absoluteY);
          holdX.set(e.absoluteX);
          holdY.set(e.absoluteY);
          hoveredRow.set(-1);
          runOnJS(openMenuAt)(e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          // Keep reporting while the finger is still down; the popup hit-tests its rows against this.
          holdX.set(e.absoluteX);
          holdY.set(e.absoluteY);
          if (!holdArmed.value) {
            const dx = e.absoluteX - holdOriginX.value;
            const dy = e.absoluteY - holdOriginY.value;
            // Latches on: past this point jitter can't disarm you mid-pick.
            if (Math.hypot(dx, dy) > HOLD_ARM_DISTANCE) holdArmed.set(true);
          }
        })
        .onEnd(() => {
          // Lift = commit whatever the finger was over. Nothing under it (you never moved, or you slid
          // off) simply leaves the menu open, which is what the iOS one does.
          const row = hoveredRow.value;
          holdActive.set(false);
          holdArmed.set(false);
          hoveredRow.set(-1);
          if (row >= 0) runOnJS(commitHoveredRow)(row);
        })
        .onFinalize(() => {
          // Cancelled rather than ended (an interrupting touch, a navigation): drop the hold, don't
          // run anything.
          holdActive.set(false);
          holdArmed.set(false);
          hoveredRow.set(-1);
        }),
    [enabled, bridgeId, openMenuAt, holdOriginX, holdOriginY],
  );

  return (
    <GestureDetector gesture={longPress}>
      {/* collapsable={false} so the view stays measurable (for refining to the card's rect). We DON'T
          hide the whole wrapper any more — the child hides just its cover via the `hidden` flag, so the
          rest of the item (title, and a History row's text) stays put under the dim. */}
      <View ref={anchorRef} collapsable={false}>
        {children({ onLongPress: undefined, hidden })}
      </View>
    </GestureDetector>
  );
}
