import { MenuView, type MenuAction } from '@expo/ui/community/menu';

/**
 * Per-card quick actions (add-to-library / favorite), presented as an OS-native context menu on a
 * long-press. Web has its own affordance — a hover-revealed 3-dot button opening the app's overlay
 * menu — so this file is the **native** implementation and `series-card-menu.web.tsx` the web one;
 * both take the same props and wrap the card's rendered tree. The favorite/library state and toggles
 * are lifted into `SeriesCard` (which owns the two hooks, armed lazily) so both platform variants are
 * pure presentation over the same data.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), render the card with no menu attached. */
  enabled: boolean;
  /** `null` while the status check is still loading — the action is shown disabled until it resolves. */
  favorited: boolean | null;
  inLibrary: boolean | null;
  onToggleFavorite: () => void;
  onToggleLibrary: () => void;
  children: React.ReactNode;
};

export function SeriesCardMenu({
  enabled,
  favorited,
  inLibrary,
  onToggleFavorite,
  onToggleLibrary,
  children,
}: SeriesCardMenuProps) {
  if (!enabled) return <>{children}</>;

  // `image` is an SF Symbol name (rendered on iOS); Android draws the `state` checkmark + title
  // instead. `state: 'on'` marks the current membership so the menu reads as a toggle, and a
  // still-loading (`null`) status disables the row until the check resolves.
  const actions: MenuAction[] = [
    {
      id: 'library',
      title: inLibrary ? 'Remove from Library' : 'Add to Library',
      image: inLibrary ? 'checkmark' : 'plus',
      state: inLibrary ? 'on' : 'off',
      attributes: { disabled: inLibrary === null },
    },
    {
      id: 'favorite',
      title: favorited ? 'Unfavorite' : 'Favorite',
      image: favorited ? 'star.fill' : 'star',
      state: favorited ? 'on' : 'off',
      attributes: { disabled: favorited === null },
    },
  ];

  return (
    <MenuView
      shouldOpenOnLongPress
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === 'library') onToggleLibrary();
        else if (nativeEvent.event === 'favorite') onToggleFavorite();
      }}>
      {children}
    </MenuView>
  );
}
