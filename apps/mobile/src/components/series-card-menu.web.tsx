import { type RefObject, useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { MoreVerticalIcon } from '@/components/icons/ui-icons';
import { useAnchoredOverlay } from '@/components/overlay/overlay';
import { SeriesActionsMenu } from '@/components/series-card-actions-menu';
import { Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * Web variant of the per-card quick-actions menu (see `series-card-menu.tsx` for the native
 * long-press version). On web there's no OS context menu, so the affordance is a 3-dot button that
 * fades in when the card is hovered and opens the app's overlay menu (an anchored popover on desktop,
 * a bottom sheet on narrow web — the same system `Selector` uses). The menu content
 * (`SeriesActionsMenu`) is shared with native and runs the status queries itself, only while open.
 *
 * `children` is a render function to match the native variant's contract (native threads a long-press
 * handler down to the card's Pressable); on web there's no long-press, so it's always undefined.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), render the card with no menu attached. */
  enabled: boolean;
  bridgeId?: string;
  entry: SeriesEntry;
  /** Cover aspect ratio, so the menu header shows the cover at its true shape. */
  coverAspect?: number;
  /** Ignored on web (no lifted preview); matches the native variant's contract — see it. */
  measureRef?: RefObject<View | null>;
  /** Always false on web (no lifted preview, so nothing to hide) — matches the native contract. */
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void; hidden: boolean }) => React.ReactNode;
};

export function SeriesCardMenu({ enabled, bridgeId, entry, coverAspect, children }: SeriesCardMenuProps) {
  const theme = useTheme();
  const { ref, openAt, isOpen } = useAnchoredOverlay();
  // Track hover on the wrapper (not the card or the button individually): moving the pointer from
  // the card onto the 3-dot button stays *inside* the wrapper, so the button doesn't flicker out
  // from under the cursor the moment you reach for it. Kept visible while the menu is open too.
  const [hovered, setHovered] = useState(false);

  if (!enabled || !bridgeId) return <>{children({ onLongPress: undefined, hidden: false })}</>;

  const show = hovered || isOpen;
  return (
    <View
      style={styles.wrapper}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}>
      {children({ onLongPress: undefined, hidden: false })}
      <Pressable
        ref={ref}
        // The button is a sibling layered above the card's <Link>, not a child of it, so a press
        // here opens the menu without also triggering navigation; stopPropagation is defensive.
        onPress={(e) => {
          e?.stopPropagation?.();
          openAt(() => <SeriesActionsMenu bridgeId={bridgeId} entry={entry} coverAspect={coverAspect} />);
        }}
        // Kept mounted (so the overlay anchor `ref` stays measurable) but only shown/interactive
        // while hovered or open — fading via opacity avoids any layout shift on the card.
        pointerEvents={show ? 'auto' : 'none'}
        aria-label="Series actions"
        style={[
          styles.trigger,
          { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
          !show && styles.hidden,
        ]}>
        <MoreVerticalIcon color={theme.text} size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Positions the absolutely-placed 3-dot button relative to the card; stretches to fill its cell
  // (grid) or hug its fixed-width card (rail), matching the card's own sizing.
  wrapper: {
    position: 'relative',
  },
  trigger: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the cover and any active-card lift.
    zIndex: 20,
  },
  hidden: {
    opacity: 0,
  },
});
