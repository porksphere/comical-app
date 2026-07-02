import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A real-API failure state: message + retry affordance. Shown instead of the
 *  old silent fall-back-to-mock-data behavior — see `src/data/source.ts`. */
export function RetryBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.block}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
        {message}
      </ThemedText>
      <Pressable onPress={onRetry} hitSlop={8}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          Retry
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  message: {
    textAlign: 'center',
  },
});
