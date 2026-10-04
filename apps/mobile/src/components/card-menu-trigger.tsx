import { type MouseEvent, type ReactNode, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ViewProps } from 'react-native';

import { openContextMenu, type ContextMenuRequest } from '@/components/context-menu-host';
import { MENU_WIDTH } from '@/components/context-menu-material';
import { MoreVerticalIcon } from '@/components/icons/ui-icons';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const MENU_GAP = 6;

/**
 * A card's menu on WEB: a 3-dot button that fades in over the card's corner while the card is
 * hovered, and the generic host's frosted panel (context-menu-host.tsx) hanging from it. A
 * right-click anywhere on the card opens the same panel at the pointer instead, in place of the
 * browser's own menu. Native cards open theirs with a hold and never mount this.
 */
export function CardMenuTrigger({
  rows,
  testID,
  label,
  children,
}: {
  rows: ContextMenuRequest['rows'];
  testID: string;
  /** What the button is, to a screen reader. */
  label: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Track hover on the wrapper (not the card or the button individually): moving the pointer from
  // the card onto the 3-dot button stays *inside* the wrapper, so the button doesn't flicker out
  // from under the cursor the moment you reach for it. Kept visible while the menu is open too.
  const [hovered, setHovered] = useState(false);

  // `x`/`y` is the menu's top-left corner.
  const openAt = (x: number, y: number) => {
    setIsOpen(true);
    openContextMenu({ x, y, anchor: 'fixed', onClose: () => setIsOpen(false), rows });
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
      {children}
      <Pressable
        ref={ref}
        testID={testID}
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
        aria-label={label}
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
