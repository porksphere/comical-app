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

import { SearchIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function SearchPill({
  onPress,
  testID,
  placeholder = 'Search…',
}: {
  onPress: () => void;
  testID: string;
  placeholder?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={placeholder}
      style={styles.pill}>
      <ThemedView type="backgroundElement" style={styles.inner}>
        <SearchIcon color={theme.textSecondary} size={16} />
        <ThemedText type="small" themeColor="textSecondary">
          {placeholder}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { width: 260 },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});
