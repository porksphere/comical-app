/**
 * The pieces the two import screens (bridge favorites, tracker lists) share: a settings-row list of
 * covers with the select-mode chrome. Both screens are the same shape — rows of `SettingsRow` +
 * `SelectLead` + a cover, an intro line, a floating pill bar — so the row cover and the layout
 * styles live here rather than in two copies that would drift.
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

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

export const importStyles = StyleSheet.create({
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
