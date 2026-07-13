import { Image } from 'expo-image';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Side of the rounded artwork/glyph tile that leads a settings list row. Sized to sit inside the
 *  row's `RowHeight` without growing it. */
const ICON_SIZE = 28;

/**
 * The leading tile on a Bridges/Trackers/Registries row: a bridge's own icon where it has one
 * (`BridgeSummary.info.iconUrl`), and otherwise a glyph on a tinted rounded square.
 *
 * The fallback is not optional decoration — it's what keeps the column aligned. A list where only
 * SOME rows carry artwork would have the rest of its labels start at a different x, which reads as
 * broken rather than as sparse.
 */
export function RowIcon({ uri, fallback }: { uri?: string; fallback: (color: string, size: number) => ReactNode }) {
  const theme = useTheme();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
        contentFit="cover"
        // Icons are tiny and near-always cached; a transition here just makes the list flicker on
        // every scroll-back.
        transition={0}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.tile, styles.fallback, { backgroundColor: theme.backgroundElement }]}>
      {fallback(theme.textSecondary, 16)}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: Spacing.two,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
