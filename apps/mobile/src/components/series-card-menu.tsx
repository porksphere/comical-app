import { useCallback } from 'react';
import type { GestureResponderEvent } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { SeriesActionsMenu } from '@/components/series-card-actions-menu';
import type { SeriesEntry } from '@/data/types';

/**
 * Native (iOS + Android) per-card quick-actions menu. A long-press anywhere on the card opens the
 * app's shared overlay menu (a bottom sheet) — see `series-card-actions-menu.tsx`. Web has its own
 * affordance (a hover-revealed 3-dot button), in `series-card-menu.web.tsx`.
 *
 * There is deliberately NO per-card native context-menu host here anymore. Wrapping every grid cell
 * in a SwiftUI `Host` + `ContextMenu` (the old `.ios.tsx`) mounted a native menu host per cell that
 * was re-created as LegendList recycled rows — the dominant cause of iOS scroll jank. The long-press
 * now just opens one shared menu on demand, so scrolling cards pay nothing.
 *
 * Children is a render function so the long-press handler lands on the card's OWN Pressable: a
 * wrapping Pressable would steal the tap from the inner navigation Pressable (RN gives the touch to
 * the deepest responder), so the handler must be threaded down to it.
 *
 * The menu opens as an anchored popover next to where you pressed (via `preferPopover` + the touch
 * point as anchor), kept fully on-screen by the overlay — not a full-width bottom sheet.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), the card renders with no menu (onLongPress undefined). */
  enabled: boolean;
  bridgeId?: string;
  entry: SeriesEntry;
  /** Cover aspect ratio, so the menu header shows the cover at its true shape. */
  coverAspect?: number;
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void }) => React.ReactNode;
};

export function SeriesCardMenu({ enabled, bridgeId, entry, coverAspect, children }: SeriesCardMenuProps) {
  const { open } = useOverlay();
  const onLongPress = useCallback(
    (e: GestureResponderEvent) => {
      if (!bridgeId) return;
      // Anchor the popover at the touch point (a zero-size rect); the overlay clamps it on-screen and
      // flips above/below by available space, so it lands right next to the card, fully visible.
      const { pageX, pageY } = e.nativeEvent;
      open(
        () => <SeriesActionsMenu bridgeId={bridgeId} entry={entry} coverAspect={coverAspect} />,
        { x: pageX, y: pageY, width: 0, height: 0 },
        { preferPopover: true },
      );
    },
    [open, bridgeId, entry, coverAspect],
  );
  return <>{children({ onLongPress: enabled ? onLongPress : undefined })}</>;
}
