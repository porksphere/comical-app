import { useCallback } from 'react';

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
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), the card renders with no menu (onLongPress undefined). */
  enabled: boolean;
  bridgeId?: string;
  entry: SeriesEntry;
  /** Cover aspect ratio, so the menu header shows the cover at its true shape. */
  coverAspect?: number;
  children: (api: { onLongPress?: () => void }) => React.ReactNode;
};

export function SeriesCardMenu({ enabled, bridgeId, entry, coverAspect, children }: SeriesCardMenuProps) {
  const { open } = useOverlay();
  const onLongPress = useCallback(() => {
    if (!bridgeId) return;
    open(() => <SeriesActionsMenu bridgeId={bridgeId} entry={entry} coverAspect={coverAspect} />);
  }, [open, bridgeId, entry, coverAspect]);
  return <>{children({ onLongPress: enabled ? onLongPress : undefined })}</>;
}
