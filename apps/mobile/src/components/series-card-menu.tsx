import { useMemo } from 'react';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';

import { SeriesCardMenuStatus, useCardMenuStatus } from '@/components/series-card-menu-status';
import type { SeriesEntry } from '@/data/types';

/**
 * Per-card quick actions (add-to-library / favorite), presented as an OS-native context menu on a
 * long-press. Web has its own affordance — a hover-revealed 3-dot button opening the app's overlay
 * menu — so this file is the **native** implementation (Android; iOS has its own `.ios.tsx` with a
 * lifted preview) and `series-card-menu.web.tsx` the web one; all take the same props and wrap the
 * card's rendered tree.
 *
 * The favorite/library status queries are deferred: they only run once the card is `armed` (first
 * press-in), via the armed-gated `SeriesCardMenuStatus` — so a scrolling grid of untouched cards
 * pays nothing. See `series-card-menu-status.tsx`.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), render the card with no menu attached. */
  enabled: boolean;
  /** True once the user has engaged this card (press-in / hover). Gates the status queries. */
  armed: boolean;
  bridgeId?: string;
  entry: SeriesEntry;
  /** Cover aspect ratio. Unused here (no preview surface); accepted so the prop shape matches the
   *  iOS variant, whose lifted preview shows the cover at its true shape. */
  coverAspect?: number;
  children: React.ReactNode;
};

export function SeriesCardMenu({ enabled, armed, bridgeId, entry, children }: SeriesCardMenuProps) {
  const { status, togglesRef, onStatus } = useCardMenuStatus();

  // `image` is an SF Symbol name (rendered on iOS); Android draws the `state` checkmark + title
  // instead. `state: 'on'` marks the current membership so the menu reads as a toggle, and a
  // still-loading (`null`) status disables the row until the check resolves. Memoized so recycling a
  // card (new children) doesn't churn the native menu's action props while nothing relevant changed.
  const actions = useMemo<MenuAction[]>(
    () => [
      {
        id: 'library',
        title: status.inLibrary ? 'Remove from Library' : 'Add to Library',
        image: status.inLibrary ? 'checkmark' : 'plus',
        state: status.inLibrary ? 'on' : 'off',
        attributes: { disabled: status.inLibrary === null },
      },
      {
        id: 'favorite',
        title: status.favorited ? 'Unfavorite' : 'Favorite',
        image: status.favorited ? 'star.fill' : 'star',
        state: status.favorited ? 'on' : 'off',
        attributes: { disabled: status.favorited === null },
      },
    ],
    [status.favorited, status.inLibrary],
  );

  if (!enabled) return <>{children}</>;

  return (
    <>
      {armed && bridgeId && (
        <SeriesCardMenuStatus bridgeId={bridgeId} entry={entry} onStatus={onStatus} togglesRef={togglesRef} />
      )}
      <MenuView
        title={entry.title}
        shouldOpenOnLongPress
        actions={actions}
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === 'library') togglesRef.current.library();
          else if (nativeEvent.event === 'favorite') togglesRef.current.favorite();
        }}>
        {children}
      </MenuView>
    </>
  );
}
