import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { GLASS_BLUR } from '@/hooks/use-glass-chrome';
import { useTheme } from '@/hooks/use-theme';

/** The bar capsules' height, and so their corner. */
export const GLASS_CONTROL_HEIGHT = 36;
/** The search field the shell stands at the trailing end of every tab's bare bar (`ShellSearchField`). */
export const SHELL_SEARCH_WIDTH = 240;
/** What a bar's row keeps clear at its trailing end for that field. */
export const SHELL_SEARCH_RESERVE = SHELL_SEARCH_WIDTH + 12;

const blur = (px: number) => (GLASS_BLUR ? ({ backdropFilter: `blur(${px}px) saturate(1.8)` } as ViewStyle) : null);
const CAPSULE_BLUR = blur(24);
const PANEL_BLUR = blur(40);

/**
 * A surface of the desktop chrome: a wash over a blur of whatever is behind it, with a hairline
 * edge. `panel` is the sidebar's, heavier and shadowed. Without a blur to stand on (Android) it is
 * the opaque panel colour, since a wash alone would leave its rows over the page's own content.
 */
export function GlassSurface({ panel, style, ...props }: ViewProps & { panel?: boolean }) {
  const theme = useTheme();
  const fill = !GLASS_BLUR ? theme.backgroundPanel : panel ? theme.glassPanel : theme.glassFill;
  return (
    <View
      {...props}
      style={[
        styles.glass,
        { backgroundColor: fill, borderColor: theme.glassEdge },
        panel ? PANEL_BLUR : CAPSULE_BLUR,
        panel && styles.panel,
        style,
      ]}
    />
  );
}

/**
 * A bare bar's capsule: its title, or a control. `art` is for one that leads with a picture, which
 * sits in the capsule's end the way a picture sits in a round button, the same margin all round.
 */
export function GlassCapsule({ art, round, style, ...props }: ViewProps & { art?: boolean; round?: boolean }) {
  return (
    <GlassSurface {...props} style={[styles.capsule, art && styles.capsuleWithArt, round && styles.round, style]} />
  );
}

const styles = StyleSheet.create({
  glass: {
    borderWidth: 1,
  },
  // Shrinks before the bar's trailing controls do.
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
    height: GLASS_CONTROL_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: GLASS_CONTROL_HEIGHT / 2,
  },
  capsuleWithArt: {
    paddingLeft: 3,
  },
  // A capsule that is one icon: a circle.
  round: {
    width: GLASS_CONTROL_HEIGHT,
    paddingHorizontal: 0,
    justifyContent: 'center',
    flexShrink: 0,
  },
  panel: {
    boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
  },
});
