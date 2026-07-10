import { useCallback, useRef } from 'react';
import { View, type GestureResponderEvent } from 'react-native';

import type { SeriesEntry } from '@/data/types';
import { openSeriesCardMenu } from '@/lib/series-card-menu';

/**
 * Native (iOS + Android) per-card quick-actions menu. A long-press anywhere on the card opens the
 * iOS / X-style hold-down menu — a dimmed backdrop, the card lifted as a preview, and a rounded menu
 * springing in from its edge (rendered by the root `SeriesCardContextMenuHost`, driven by
 * `openSeriesCardMenu`). Web has its own affordance (a hover 3-dot button), in the `.web.tsx` file.
 *
 * There is no per-card native context-menu host: wrapping every grid cell in a SwiftUI
 * `Host`/`ContextMenu` (the old `.ios.tsx`) was re-created as LegendList recycled rows — the cause
 * of iOS scroll jank. Now scrolling cards cost nothing; the menu is built on demand, once, on press.
 *
 * A thin measuring `View` wraps the card so we can anchor the menu (and the lifted preview) to the
 * card's on-screen rect. Children is a render function so the long-press handler lands on the card's
 * OWN Pressable — a wrapping Pressable would steal the tap from the inner navigation Pressable.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), the card renders with no menu (onLongPress undefined). */
  enabled: boolean;
  bridgeId?: string;
  entry: SeriesEntry;
  /** Cover aspect ratio, so the lifted preview matches the card's shape. */
  coverAspect?: number;
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void }) => React.ReactNode;
};

export function SeriesCardMenu({ enabled, bridgeId, entry, coverAspect, children }: SeriesCardMenuProps) {
  const anchorRef = useRef<View>(null);
  const onLongPress = useCallback(() => {
    if (!bridgeId) return;
    // Measure the card in window coords so the menu opens anchored to its edge and the lifted preview
    // starts exactly over it.
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      if (!width && !height) return; // not measurable (shouldn't happen once laid out)
      openSeriesCardMenu({ entry, bridgeId, coverAspect, rect: { x, y, width, height } });
    });
  }, [bridgeId, entry, coverAspect]);
  return (
    // collapsable={false} so Android keeps the view around to be measurable.
    <View ref={anchorRef} collapsable={false}>
      {children({ onLongPress: enabled ? onLongPress : undefined })}
    </View>
  );
}
