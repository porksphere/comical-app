/**
 * The search control the wide layout puts at the trailing edge of every content tab's bar.
 *
 * One control in one place, because the alternative it replaced was three: a centred pill on Browse,
 * an icon on Library, nothing on History or Activity. What it SEARCHES still differs per tab — Browse
 * queries the source catalogue, the rest filter rows already on screen — but where you reach for it
 * does not.
 *
 * Trailing, not centred: with the rail carrying navigation, the bar's leading edge is the screen's
 * title and its trailing edge is where its actions live. The centred pill also reserved room for the
 * top-right icon nav, which does not exist at these widths.
 */
import { Pressable, StyleSheet } from 'react-native';

import { GLASS_CONTROL_HEIGHT, GlassSurface } from '@/components/glass-surface';
import { SearchIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A bare bar's trailing field: this pill, or a tab's filter in the same place. */
export const GLASS_FIELD_WIDTH = 240;

export function SearchPill({
  onPress,
  testID,
  placeholder = 'Search…',
  glass = false,
}: {
  onPress: () => void;
  testID: string;
  placeholder?: string;
  /** In a bare bar (`useGlassChrome`), where the pill is one of its capsules. */
  glass?: boolean;
}) {
  const theme = useTheme();
  const content = (
    <>
      <SearchIcon color={theme.textSecondary} size={glass ? 15 : 16} />
      <ThemedText type="small" themeColor="textSecondary" style={glass && styles.glassLabel}>
        {placeholder}
      </ThemedText>
    </>
  );
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={placeholder}
      style={glass ? styles.glassPill : styles.pill}>
      {glass ? (
        <GlassSurface style={[styles.inner, styles.glassInner]}>{content}</GlassSurface>
      ) : (
        <ThemedView type="backgroundElement" style={styles.inner}>
          {content}
        </ThemedView>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { width: 260 },
  glassPill: { width: GLASS_FIELD_WIDTH },
  glassInner: {
    height: GLASS_CONTROL_HEIGHT,
    borderRadius: GLASS_CONTROL_HEIGHT / 2,
  },
  glassLabel: { fontSize: 13 },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: 20,
  },
});
