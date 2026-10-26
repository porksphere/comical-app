import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, TopLevelGutter } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The strip's fixed height, which the content below it pads by (see the Browse screen). */
export const PAGE_STRIP_HEIGHT = 44;

/**
 * The bridge's pages as a row of pills under the iOS navigation bar — the page picker the custom
 * bar carries as a selector and the native bar has no room for: with the bridge menu, the search
 * item and the thumbnail already there, a third capsule read as clutter. A fixed strip rather than
 * a list header because ContentFeed gives up its pinned section headings when it has one.
 *
 * Opaque, so the content scrolling under it reads as passing beneath the chrome rather than
 * bleeding through, the way the blurred bar above it handles the same thing.
 */
export function PageStrip({
  top,
  options,
  labels,
  value,
  onChange,
}: {
  /** The strip's top edge: the navigation bar's bottom. */
  top: number;
  options: string[];
  labels: Record<string, string>;
  value: string;
  onChange: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.strip, { top, backgroundColor: theme.background }]} testID="browse.page-strip">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {options.map((key) => {
          const active = key === value;
          return (
            <Pressable
              key={key}
              testID={`browse.page-strip.${key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(key)}
              style={[styles.pill, { backgroundColor: active ? theme.accent : theme.chipBg }]}>
              <ThemedText
                type="smallBold"
                style={{ color: active ? theme.accentOn : theme.textSecondary }}
                numberOfLines={1}>
                {labels[key] ?? key}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: PAGE_STRIP_HEIGHT,
    justifyContent: 'center',
  },
  row: {
    paddingHorizontal: TopLevelGutter,
    gap: Spacing.one,
    alignItems: 'center',
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
});
