import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { loginRequiredOf } from '@/data/api';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

/** A real-API failure state: message + retry affordance. Shown instead of the
 *  old silent fall-back-to-mock-data behavior — see `src/data/source.ts`. Pass the
 *  `error` itself and a bridge asking for a sign-in also gets a way to its settings. */
export function RetryBlock({ message, onRetry, error }: { message: string; onRetry: () => void; error?: unknown }) {
  const theme = useTheme();
  const router = useRouter();
  const signInTo = loginRequiredOf(error)?.bridgeId;
  return (
    <View style={styles.block}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
        {message}
      </ThemedText>
      <View style={styles.actions}>
        {signInTo && (
          <Pressable
            testID="retry.sign-in"
            onPress={() => router.push({ pathname: '/bridge-settings', params: { bridgeId: signInTo } })}
            hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              Sign in
            </ThemedText>
          </Pressable>
        )}
        <Pressable testID="retry.button" onPress={onRetry} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Retry
          </ThemedText>
        </Pressable>
      </View>
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
  actions: {
    flexDirection: 'row',
    gap: Spacing.four,
  },
});
