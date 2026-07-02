import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

/**
 * Static top bar (back button + centered title) shared by every pushed detail
 * screen. Originally built inline in series.tsx; extracted so every screen
 * pushed on top of the tabs (bridge/tracker settings, registries, …) gets the
 * same back-button style and the same `useTopBarHeight()` sizing instead of
 * falling back to the native stack header, which looks different per platform.
 * Pair with `<Stack.Screen name="..." options={{ headerShown: false }} />` in
 * `_layout.tsx` and use `useTopBarInset()` to pad the screen's own content.
 */
export function TopBar({ title, onBack }: { title: string; onBack?: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const barHeight = useTopBarHeight();
  return (
    <View
      style={[
        styles.topBar,
        { paddingTop: insets.top, height: insets.top + barHeight, borderBottomColor: theme.hairline },
      ]}>
      <Pressable
        onPress={onBack ?? (() => router.back())}
        hitSlop={12}
        style={[styles.backButton, { height: barHeight }]}
        accessibilityRole="button"
        accessibilityLabel="Go back">
        <ChevronLeftIcon color={theme.text} />
      </Pressable>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
    </View>
  );
}

/** Total height `<TopBar>` occupies (safe-area inset + bar), for padding the screen below it. */
export function useTopBarInset(): number {
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  return insets.top + barHeight;
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    position: 'absolute',
    left: Spacing.three,
    bottom: 0,
    justifyContent: 'center',
  },
  title: {
    maxWidth: '70%',
  },
});
