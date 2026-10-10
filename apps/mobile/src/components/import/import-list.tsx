/**
 * The pieces the two import screens (bridge favorites, tracker lists) share: a settings-row list of
 * covers with the select-mode chrome. Both screens are the same shape — rows of `SettingsRow` +
 * `SelectLead` + a cover, an intro line, a floating pill bar — so the row cover and the layout
 * styles live here rather than in two copies that would drift.
 */
import { Image } from 'expo-image';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ArrowRightIcon, BridgesIcon, TrackersIcon } from '@/components/icons/ui-icons';
import { RowIcon } from '@/components/settings/row-icon';
import { ThemedText } from '@/components/themed-text';
import { SettingsGutter, Spacing } from '@/constants/theme';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';

/** Cover width in a row. Its 2:3 crop is 45px tall, which clears a 64px settings row's padding. */
export const IMPORT_THUMB_W = 30;

/** The row's cover. A component so `useResolvedAsset` (a hook) runs per row, not in `renderItem`. */
export function ImportCover({ url }: { url?: string }) {
  const theme = useTheme();
  const thumb = useResolvedAsset(url);
  if (!thumb) return <View style={[importStyles.thumb, { backgroundColor: theme.backgroundElement }]} />;
  return (
    <Image source={{ uri: thumb }} style={importStyles.thumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
  );
}

/**
 * Where a row's entry goes, as icons leading the row: the service it comes from, an arrow, and the
 * source it lands on. A series the library holds on several sources shows the first with a "+N"
 * badge; a row with no source yet shows `pending` in that tile, so every row's route is the same
 * width and the covers stay in one column.
 */
export function MatchRoute({
  fromIcon,
  toIcons,
  pending,
}: {
  fromIcon?: string | undefined;
  toIcons: readonly (string | undefined)[];
  pending: (color: string, size: number) => ReactNode;
}) {
  const theme = useTheme();
  const more = toIcons.length - 1;
  return (
    <View style={importStyles.route} accessible={false}>
      <RowIcon uri={fromIcon} fallback={(color, size) => <TrackersIcon color={color} size={size} />} />
      <ArrowRightIcon color={theme.textSecondary} size={14} />
      <View>
        <RowIcon uri={toIcons[0]} fallback={toIcons.length > 0 ? (color, size) => <BridgesIcon color={color} size={size} /> : pending} />
        {more > 0 && (
          <View style={[importStyles.routeBadge, { backgroundColor: theme.backgroundSelected, borderColor: theme.background }]}>
            <ThemedText style={[importStyles.routeBadgeText, { color: theme.text }]}>+{more}</ThemedText>
          </View>
        )}
      </View>
    </View>
  );
}

export const importStyles = StyleSheet.create({
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  routeBadge: {
    position: 'absolute',
    right: -Spacing.one - 2,
    bottom: -Spacing.one - 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeBadgeText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
  },
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  banner: {
    paddingTop: Spacing.two,
  },
  intro: {
    paddingBottom: Spacing.four,
  },
  thumb: {
    width: IMPORT_THUMB_W,
    aspectRatio: 2 / 3,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  // The settings-standard inset divider (see the Downloads page): absolute so rows stay exactly one
  // settings-row tall for the fixed-size list.
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: -SettingsGutter,
    height: StyleSheet.hairlineWidth,
  },
  state: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.five,
  },
  stateText: {
    textAlign: 'center',
  },
  footerNote: {
    paddingTop: Spacing.four,
    textAlign: 'center',
  },
});
