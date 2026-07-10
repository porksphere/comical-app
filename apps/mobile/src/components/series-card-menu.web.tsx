import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CheckIcon, MoreVerticalIcon, PlusIcon, StarIcon, type IconProps } from '@/components/icons/ui-icons';
import { OptionList, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { SeriesCardMenuStatus, useCardMenuStatus } from '@/components/series-card-menu-status';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { RowHeight, Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * Web variant of the per-card quick-actions menu (see `series-card-menu.tsx` for the native
 * long-press version). On web there's no OS context menu, so the affordance is a 3-dot button that
 * fades in when the card is hovered and opens the app's overlay menu (an anchored popover on desktop,
 * a bottom sheet on narrow web — the same system `Selector` uses).
 *
 * The favorite/library status queries are deferred behind `armed` (set on hover), via the armed-gated
 * `SeriesCardMenuStatus`, so a scrolling grid of un-hovered cards runs no per-card status checks.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), render the card with no menu attached. */
  enabled: boolean;
  /** True once the user has engaged this card (hover). Gates the status queries. */
  armed: boolean;
  bridgeId?: string;
  entry: SeriesEntry;
  /** Cover aspect ratio. Unused on web; accepted so the prop shape matches the iOS variant. */
  coverAspect?: number;
  children: React.ReactNode;
};

export function SeriesCardMenu({ enabled, armed, bridgeId, entry, children }: SeriesCardMenuProps) {
  const theme = useTheme();
  const { ref, openAt, isOpen } = useAnchoredOverlay();
  // Track hover on the wrapper (not the card or the button individually): moving the pointer from
  // the card onto the 3-dot button stays *inside* the wrapper, so the button doesn't flicker out
  // from under the cursor the moment you reach for it. Kept visible while the menu is open too.
  const [hovered, setHovered] = useState(false);
  const { status, togglesRef, onStatus } = useCardMenuStatus();

  if (!enabled) return <>{children}</>;

  const show = hovered || isOpen;
  return (
    <View
      style={styles.wrapper}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}>
      {armed && bridgeId && (
        <SeriesCardMenuStatus bridgeId={bridgeId} entry={entry} onStatus={onStatus} togglesRef={togglesRef} />
      )}
      {children}
      <Pressable
        ref={ref}
        // The button is a sibling layered above the card's <Link>, not a child of it, so a press
        // here opens the menu without also triggering navigation; stopPropagation is defensive.
        onPress={(e) => {
          e?.stopPropagation?.();
          openAt(() => (
            <SeriesActionsMenu
              favorited={status.favorited}
              inLibrary={status.inLibrary}
              onToggleFavorite={() => togglesRef.current.favorite()}
              onToggleLibrary={() => togglesRef.current.library()}
            />
          ));
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

function SeriesActionsMenu({
  favorited,
  inLibrary,
  onToggleFavorite,
  onToggleLibrary,
}: {
  favorited: boolean | null;
  inLibrary: boolean | null;
  onToggleFavorite: () => void;
  onToggleLibrary: () => void;
}) {
  const { closeTop } = useOverlay();
  return (
    <View style={styles.menu}>
      <OptionList>
        <ActionRow
          label={inLibrary ? 'In Library' : 'Add to Library'}
          Icon={inLibrary ? CheckIcon : PlusIcon}
          loading={inLibrary === null}
          active={!!inLibrary}
          onPress={() => {
            onToggleLibrary();
            closeTop();
          }}
        />
        <ActionRow
          label={favorited ? 'Favorited' : 'Favorite'}
          Icon={StarIcon}
          loading={favorited === null}
          active={!!favorited}
          onPress={() => {
            onToggleFavorite();
            closeTop();
          }}
        />
      </OptionList>
    </View>
  );
}

function ActionRow({
  label,
  Icon,
  loading,
  active,
  onPress,
}: {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** Status still resolving — row is dimmed and inert. */
  loading: boolean;
  /** Currently favorited / in library — tints the row with the accent and shows a trailing dot. */
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const color = loading ? theme.textSecondary : active ? theme.accent : theme.text;
  return (
    <Pressable
      onPress={loading ? undefined : onPress}
      disabled={loading}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && !loading && { backgroundColor: theme.backgroundSelected }, loading && styles.rowLoading]}>
        <Icon color={color} size={18} />
        <ThemedText style={[styles.rowLabel, { color }]} numberOfLines={1}>
          {label}
        </ThemedText>
        {active && <View style={[styles.stateDot, { backgroundColor: theme.accent }]} />}
      </ThemedView>
    </Pressable>
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
  // Hug the OptionList (mirrors selector.tsx's `menu`).
  menu: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: RowHeight,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowLoading: {
    opacity: 0.5,
  },
  rowLabel: {
    flex: 1,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
