import { Stack } from 'expo-router';
import { type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarSurface } from '@/components/bar-surface';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { PaneActions } from '@/components/settings/pane-actions';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useInSettingsPane } from '@/lib/settings-pane';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';
import { useWindowControlsClearance } from '@/lib/window-controls';

/**
 * A bar action, drawn by whichever bar is up: the custom bar as a `TopBarButton` with its
 * `icon`, the system bar as a `Stack.Toolbar.Button` — an SF Symbol, or a word at the weight
 * the system gives it ("Select", "Done"). Without `native` the action is the custom bar's
 * only (a refresh that stands in for pull-to-refresh on the web).
 */
export type TopBarAction = {
  label: string;
  /** Automation selector — required so every top-bar action is reachable (see src/lib/test-id.ts). */
  testID: string;
  onPress: () => void;
  icon: ReactNode;
  native?: { symbol: BarSymbol } | { text: string; variant?: 'done' | 'prominent' };
};

type BarSymbol = NonNullable<ComponentProps<typeof Stack.Toolbar.Button>['icon']>;

/**
 * The top bar of every pushed screen (bridge/tracker settings, registries, the download pages, …).
 *
 * On iOS it IS the system navigation bar: the screen is registered with `settingsScreen()` /
 * `pushedScreen` (`lib/native-bar.ts`), and this retitles that bar as the screen goes (a
 * selection's count) and puts the `actions` in it as trailing toolbar items — the back chevron
 * is the stack's own, so `onBack`, `left` and `right` have no say there. Elsewhere it is the
 * custom overlay (back button + centered title + the actions), the same on every screen
 * instead of the native header's per-platform look, and the content pads past it by
 * `useTopChromeHeight()` / `useSettingsScrollPadding()`.
 */
export function TopBar({
  title,
  onBack,
  left,
  right,
  actions,
}: {
  title: string;
  onBack?: () => void;
  /** REPLACES the back button (e.g. a selection mode's staging actions). The screen must offer its
   *  own way out of whatever state hides the back affordance. */
  left?: ReactNode;
  right?: ReactNode;
  /** Trailing actions; wins over `right`, which stays for one-off trailing content. */
  actions?: TopBarAction[];
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const barHeight = useTopBarHeight();
  const clearance = useWindowControlsClearance();
  const inPane = useInSettingsPane();
  // Inside the settings modal the pane has no bar of its own: the modal supplies the header, and a
  // back button here would point at a stack this pane isn't on. The trailing actions still have to
  // land somewhere, so they go into that header.
  const trailing = actions ? (
    <View style={styles.actions}>
      {actions.map((action) => (
        <TopBarButton key={action.testID} testID={action.testID} icon={action.icon} label={action.label} onPress={action.onPress} />
      ))}
    </View>
  ) : (
    right
  );
  if (inPane) return <PaneActions>{trailing}</PaneActions>;
  if (NATIVE_HEADER) {
    const items = actions?.filter((action) => action.native) ?? [];
    return (
      <>
        <Stack.Screen options={{ title }} />
        {items.length > 0 ? (
          <Stack.Toolbar placement="right">
            {items.map((action) =>
              action.native && 'symbol' in action.native ? (
                <Stack.Toolbar.Button key={action.testID} icon={action.native.symbol} accessibilityLabel={action.label} onPress={action.onPress} />
              ) : (
                <Stack.Toolbar.Button key={action.testID} variant={action.native?.variant} accessibilityLabel={action.label} onPress={action.onPress}>
                  {action.native?.text}
                </Stack.Toolbar.Button>
              ),
            )}
          </Stack.Toolbar>
        ) : null}
      </>
    );
  }
  return (
    <BarSurface style={[styles.topBar, { height: insets.top + barHeight }]}>
      {left ? (
        <View style={[styles.leftAction, { height: barHeight }]}>{left}</View>
      ) : (
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
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      {/* Trailing action (e.g. the "+" that adds a registry / installs a bridge). Absolute, like the
          back button, so it can't push the centered title off-center. */}
      {trailing && <View style={[styles.rightAction, { height: barHeight, right: Spacing.three + clearance }]}>{trailing}</View>}
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
 * (behind it — the bar is opaque) instead of being clipped by a dead strip above it.
 */
export function useTopBarInset(): number {
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  return insets.top + barHeight;
}

const styles = StyleSheet.create({
  // OVERLAYS the screen's content (which pads itself by `useTopBarInset`) rather than sitting above
  // it in flow, so content passes underneath rather than stopping at a dead strip. It used to matter
  // for a second reason too: the bar was frosted, and a blur with nothing behind it rendered as a
  // flat solid — which is why the series/settings bars read as unblurred while Browse (an overlay)
  // didn't. The bars are plainly opaque now, so only the layout reason is left.
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
  leftAction: {
    position: 'absolute',
    left: Spacing.three,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rightAction: {
    position: 'absolute',
    right: Spacing.three,
    bottom: 0,
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  barButton: {
    padding: Spacing.one,
    cursor: 'pointer',
  },
  title: {
    maxWidth: '70%',
  },
});
