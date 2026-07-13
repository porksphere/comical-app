import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PullIndicator } from '@/components/pull-indicator';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';

/**
 * A settings-style scroll surface with the app's shared pull-to-refresh wired in — the SAME
 * `usePullToRefresh` machinery Browse and Search use (the custom open-book indicator + the touch/
 * native gesture sourcing), packaged for the `SettingsSection` category pages (Bridges / Trackers /
 * Registries) so each doesn't re-wire the scrollY shared value, the list shift, and the indicator
 * placement by hand. It also owns the shared settings content layout + padding, so those pages stop
 * repeating the `[styles.content, contentPadding]` boilerplate too.
 *
 * Pass an async `refresh` (a query `refetch`, optionally preceded by a metadata reconcile); the
 * spinner holds until it resolves. `children` are the section content (rows, empty states, retry).
 */
export function RefreshableSettingsScroll({
  refresh,
  children,
}: {
  refresh: () => Promise<unknown>;
  children: ReactNode;
}) {
  const contentPadding = useSettingsScrollPadding();
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  const scrollY = useSharedValue(0);
  const pull = usePullToRefresh(scrollY, refresh);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  return (
    // Touch-driven pull (web + Android) is caught on the outer view so it works regardless of what's
    // under the finger; iOS sources its pull from the scroll bounce instead (touchHandlers is null).
    <View style={styles.host} {...pull.touchHandlers}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollEndDrag={pull.onScrollEndDrag}
        // Fill the viewport even when the list is short (flexGrow below) and always allow the iOS
        // vertical bounce — so a pull anywhere on the page engages the refresh, not just over content.
        alwaysBounceVertical
        contentContainerStyle={[styles.contentContainer, contentPadding]}>
        {/* The list shift the pull opens rides this wrapper; the shared content layout lives here too.
            flexGrow makes it stretch to the full page height so the pull is reachable everywhere. */}
        <Animated.View style={[styles.content, pull.listStyle]}>{children}</Animated.View>
      </Animated.ScrollView>
      {/* Settles just below the top bar's resting bottom edge, in the gap the pull opens. */}
      <PullIndicator {...pull.indicator} top={insets.top + barHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  // At least fill the scroll viewport (so short lists are still full-height and pullable), while
  // still growing past it when the content is taller than the screen.
  contentContainer: {
    flexGrow: 1,
  },
  content: {
    flexGrow: 1,
    // Spacing BETWEEN sections (SettingsSection carries no top margin — see settings-row).
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
