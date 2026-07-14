import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CheckIcon, PlusIcon, StarIcon, type IconProps } from '@/components/icons/ui-icons';
import { OptionList, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { RowHeight, Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import { useTheme } from '@/hooks/use-theme';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';

/**
 * The per-series quick-actions menu content, shared by the native long-press menu and the web 3-dot
 * menu. It's rendered inside the app overlay (a bottom sheet on phones, an anchored popover on
 * desktop-web) and mounted ONLY while the menu is open — so the two status queries (`useFavorite` /
 * `useLibrary`) run once, on open, instead of once per card. That's what lets the grid drop the
 * per-card native context-menu host (the iOS scroll tax) without losing the actions or the
 * full-title / cover reveal that the old iOS lifted preview provided.
 */
export function SeriesActionsMenu({
  bridgeId,
  entry,
  coverAspect,
}: {
  bridgeId: string;
  entry: SeriesEntry;
  coverAspect?: number;
}) {
  const { closeTop } = useOverlay();
  const { favorited, toggle: toggleFavorite, available: favoritesAvailable } = useFavorite(bridgeId, entry.id);
  const { inLibrary, toggle: toggleLibrary } = useLibrary(bridgeId, entry.id, () => ({
    title: entry.title,
    ...(entry.cover ? { thumbnailUrl: entry.cover } : {}),
  }));
  return (
    <View style={styles.menu}>
      <MenuHeader title={entry.title} cover={entry.cover} coverAspect={coverAspect} />
      <OptionList>
        <ActionRow
          label={inLibrary ? 'Remove from Library' : 'Add to Library'}
          Icon={inLibrary ? CheckIcon : PlusIcon}
          loading={inLibrary === null}
          active={!!inLibrary}
          onPress={() => {
            toggleLibrary();
            closeTop();
          }}
        />
        <ActionRow
          label={favorited ? 'Unfavorite' : 'Favorite'}
          Icon={StarIcon}
          loading={favorited === null}
          // Greyed + inert when this bridge's favorites need a login that isn't set (see useFavorite).
          disabled={!favoritesAvailable}
          active={!!favorited}
          onPress={() => {
            toggleFavorite();
            closeTop();
          }}
        />
      </OptionList>
    </View>
  );
}

/** Cover thumbnail + full (unclamped) title — the reveal the long-press affords, since the card's own
 *  title is line-clamped. */
function MenuHeader({ title, cover, coverAspect }: { title: string; cover?: string; coverAspect?: number }) {
  const aspect = clampThumbAspect(coverAspect ?? DEFAULT_THUMB_ASPECT);
  const coverW = 48;
  const coverH = coverW / aspect;
  return (
    <View style={styles.header}>
      {cover ? (
        <Image
          source={{ uri: cover }}
          style={[styles.headerCover, { width: coverW, height: coverH }]}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.headerCover, styles.headerCoverEmpty, { width: coverW, height: coverH }]} />
      )}
      <ThemedText style={styles.headerTitle} numberOfLines={3}>
        {title}
      </ThemedText>
    </View>
  );
}

function ActionRow({
  label,
  Icon,
  loading,
  disabled,
  active,
  onPress,
}: {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** Status still resolving — row is dimmed and inert. */
  loading: boolean;
  /** Unavailable (e.g. favorites need a login that isn't set) — dimmed and inert, but not "loading". */
  disabled?: boolean;
  /** Currently favorited / in library — tints the row with the accent and shows a trailing dot. */
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const inert = loading || !!disabled;
  const color = inert ? theme.textSecondary : active ? theme.accent : theme.text;
  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      disabled={inert}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && !inert && { backgroundColor: theme.backgroundSelected }, inert && styles.rowLoading]}>
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
  menu: {
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.one,
  },
  headerCover: {
    borderRadius: 8,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  headerCoverEmpty: {
    backgroundColor: 'rgba(128,128,128,0.2)',
  },
  headerTitle: {
    flex: 1,
    fontWeight: '600',
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
