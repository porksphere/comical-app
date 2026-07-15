import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarSurface } from '@/components/bar-surface';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

/**
 * Static top bar (back button + centered title) shared by every pushed detail
 * screen. Originally built inline in series.tsx; extracted so every screen
 * pushed on top of the tabs (bridge/tracker settings, registries, …) gets the
 * same back-button style and the same `useTopBarHeight()` sizing instead of
 * falling back to the native stack header, which looks different per platform.
 * Pair with `<Stack.Screen name="..." options={{ headerShown: false }} />` in
 * `_layout.tsx` and use `useTopBarInset()` to pad the screen's own content.
 */
export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const barHeight = useTopBarHeight();
  return (
    <BarSurface style={[styles.topBar, { height: insets.top + barHeight }]}>
      <Pressable
        testID="top-bar.back"
        onPress={() => {
          hapticImpactLight();
          (onBack ?? (() => router.back()))();
        }}
        hitSlop={12}
        android_ripple={{ color: theme.backgroundSelected, borderless: true }}
        style={[styles.backButton, { height: barHeight }]}
        accessibilityRole="button"
        accessibilityLabel="Go back">
        <ChevronLeftIcon color={theme.text} />
      </Pressable>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      {/* Trailing action (e.g. the "+" that adds a registry / installs a bridge). Absolute, like the
          back button, so it can't push the centered title off-center. */}
      {right && <View style={[styles.rightAction, { height: barHeight }]}>{right}</View>}
    </BarSurface>
  );
}

/** A borderless icon button sized for `TopBar`'s `right` slot (the "+" on the Bridges/Trackers/
 *  Registries screens). Matches the back button's hit area and ripple. */
export function TopBarButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  /** Automation selector — required so every top-bar action is reachable (see src/lib/test-id.ts). */
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        hapticImpactLight();
        onPress();
      }}
      hitSlop={12}
      android_ripple={{ color: theme.backgroundSelected, borderless: true }}
      style={styles.barButton}
      accessibilityRole="button"
      accessibilityLabel={label}>
      {icon}
    </Pressable>
  );
}

/**
 * Total height `<TopBar>` occupies (safe-area inset + bar). REQUIRED by every screen that renders a
 * `<TopBar>`: the bar is an absolute overlay, so the screen's own scroll content must pad its top by
 * this much or its first row starts underneath the bar. In exchange, content scrolls under the bar
 * and shows through the frost.
 */
export function useTopBarInset(): number {
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  return insets.top + barHeight;
}

const styles = StyleSheet.create({
  // OVERLAYS the screen's content (which pads itself by `useTopBarInset`) rather than sitting above
  // it in flow. That's what makes the frosted bar mean anything: content has to pass UNDERNEATH it to
  // show through. In flow, there was nothing behind the bar and the blur rendered as a flat solid —
  // which is why the series/settings bars read as unblurred while Browse (an overlay) didn't.
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  backButton: {
    position: 'absolute',
    left: Spacing.three,
    bottom: 0,
    justifyContent: 'center',
  },
  rightAction: {
    position: 'absolute',
    right: Spacing.three,
    bottom: 0,
    justifyContent: 'center',
  },
  barButton: {
    padding: Spacing.one,
    cursor: 'pointer',
  },
  title: {
    maxWidth: '70%',
  },
});
