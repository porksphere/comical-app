import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PullIndicator } from '@/components/pull-indicator';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTopBarHeight } from '@/hooks/use-responsive';

/**
 * A settings page's ScrollView with the shared pull-to-refresh. `contentStyle` goes on an inner view
 * rather than the content container, because that inner view is what the pull translates — a `gap`
 * on the container would space the one wrapper instead of the sections.
 */
export function RefreshableScrollView({
  refresh,
  style,
  contentContainerStyle,
  contentStyle,
  children,
}: {
  refresh: () => Promise<unknown>;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });
  const pull = usePullToRefresh(scrollY, refresh);

  return (
    <View style={styles.host} {...pull.touchHandlers}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollEndDrag={pull.onScrollEndDrag}
        alwaysBounceVertical
        style={style}
        contentContainerStyle={[contentContainerStyle, styles.grow]}>
        <Animated.View style={[contentStyle, pull.listStyle]}>{children}</Animated.View>
      </Animated.ScrollView>
      <PullIndicator {...pull.indicator} top={insets.top + barHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
});
