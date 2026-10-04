import type { RefObject } from 'react';
import type { GestureResponderEvent, View } from 'react-native';

import { CardMenuTrigger } from '@/components/card-menu-trigger';
import { SeriesCardMenuRows } from '@/components/series-card-actions-menu';
import type { SeriesEntry } from '@/data/types';

/**
 * Web variant of the per-card quick-actions menu (see `series-card-menu.tsx` for the native
 * long-press version). The affordance is `CardMenuTrigger`'s — a 3-dot button on hover, and a
 * right-click — and the menu it opens is the native popup's menu without its preview: the same
 * rows, in the generic host's panel.
 *
 * `children` is a render function to match the native variant's contract (native threads a long-press
 * handler down to the card's Pressable); on web there's no long-press, so it's always undefined.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), render the card with no menu attached. */
  enabled: boolean;
  bridgeId?: string;
  bridge?: string;
  entry: SeriesEntry;
  /** Whether the bridge serves a direct (page-thumbnail) series — threaded to the download action. */
  direct?: boolean;
  /** Ignored on web (no lifted preview to match the shape of) — matches the native contract. */
  coverAspect?: number;
  /** Ignored on web (no lifted preview); matches the native variant's contract — see it. */
  measureRef?: RefObject<View | null>;
  /** Ignored on web (no lifted preview to give a starting radius) — matches the native contract. */
  startRadius?: number;
  /** `hidden` is always false on web (no lifted preview, so nothing to hide) — matches the native
   *  contract. `menuOpen` is true while THIS card's menu is open. */
  children: (api: {
    onLongPress?: (e: GestureResponderEvent) => void;
    hidden: boolean;
    menuOpen: boolean;
  }) => React.ReactNode;
};

export function SeriesCardMenu({ enabled, bridgeId, bridge, entry, direct, children }: SeriesCardMenuProps) {
  if (!enabled || !bridgeId) return <>{children({ onLongPress: undefined, hidden: false, menuOpen: false })}</>;

  return (
    <CardMenuTrigger
      testID="series.card-menu.trigger"
      label="Series actions"
      rows={(render) => (
        <SeriesCardMenuRows
          bridgeId={bridgeId}
          entry={entry}
          {...(bridge !== undefined && { bridge })}
          {...(direct !== undefined && { direct })}>
          {render}
        </SeriesCardMenuRows>
      )}>
      {(menuOpen) => children({ onLongPress: undefined, hidden: false, menuOpen })}
    </CardMenuTrigger>
  );
}
