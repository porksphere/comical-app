import { type MouseEvent, type RefObject, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent, type ViewProps } from 'react-native';

import { openContextMenu } from '@/components/context-menu-host';
import { MENU_WIDTH } from '@/components/context-menu-material';
import { MoreVerticalIcon } from '@/components/icons/ui-icons';
import { SeriesCardMenuRows } from '@/components/series-card-actions-menu';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * Web variant of the per-card quick-actions menu (see `series-card-menu.tsx` for the native
 * long-press version). The affordance is a 3-dot button that fades in when the card is hovered, and
 * the menu it opens is the native popup's menu without its preview: the same frosted panel from the
 * generic host (context-menu-host.tsx), hanging from the button, with the same rows. A right-click
 * anywhere on the card opens it at the pointer instead, in place of the browser's own menu.
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
  /** Always false on web (no lifted preview, so nothing to hide) — matches the native contract. */
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void; hidden: boolean }) => React.ReactNode;
};

const MENU_GAP = 6;

export function SeriesCardMenu({ enabled, bridgeId, bridge, entry, direct, children }: SeriesCardMenuProps) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Track hover on the wrapper (not the card or the button individually): moving the pointer from
  // the card onto the 3-dot button stays *inside* the wrapper, so the button doesn't flicker out
  // from under the cursor the moment you reach for it. Kept visible while the menu is open too.
  const [hovered, setHovered] = useState(false);

  if (!enabled || !bridgeId) return <>{children({ onLongPress: undefined, hidden: false })}</>;

  // `x`/`y` is the menu's top-left corner.
  const openAt = (x: number, y: number) => {
    setIsOpen(true);
    openContextMenu({
      x,
      y,
      anchor: 'fixed',
      onClose: () => setIsOpen(false),
      rows: (render) => (
        <SeriesCardMenuRows
          bridgeId={bridgeId}
          entry={entry}
          {...(bridge !== undefined && { bridge })}
          {...(direct !== undefined && { direct })}>
          {render}
        </SeriesCardMenuRows>
      ),
    });
  };
  // react-native-web forwards `onContextMenu` to the element; react-native's types don't know it.
  const rightClick = {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      openAt(e.clientX, e.clientY);
    },
  } as ViewProps;

  const show = hovered || isOpen;
  return (
    <View
      style={styles.wrapper}
      {...rightClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}>
      {children({ onLongPress: undefined, hidden: false })}
      <Pressable
        ref={ref}
        testID="series.card-menu.trigger"
        // The button is a sibling layered above the card's <Link>, not a child of it, so a press
        // here opens the menu without also triggering navigation; stopPropagation is defensive.
        onPress={(e) => {
          e?.stopPropagation?.();
          // Right edges aligned, so the menu hangs from the button over the card it belongs to.
          ref.current?.measureInWindow((x, y, w, h) => openAt(x + w - MENU_WIDTH, y + h + MENU_GAP));
        }}
        // Kept mounted (so the anchor `ref` stays measurable) but only shown/interactive
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
    ...ContinuousCorner,
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
