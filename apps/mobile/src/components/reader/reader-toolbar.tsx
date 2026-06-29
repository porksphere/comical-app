import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** Auto-hiding top toolbar over the reader: back + title + "page X of Y". */
export function ReaderToolbar({
  title,
  subtitle,
  visible,
  onBack,
}: {
  title: string;
  subtitle: string;
  visible: boolean;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: 200 }),
    transform: [{ translateY: withTiming(visible ? 0 : -8, { duration: 200 }) }],
  }));
  return (
    <Animated.View style={[styles.wrap, style]} pointerEvents={visible ? 'box-none' : 'none'}>
      <LinearGradient
        colors={['rgba(0,0,0,0.78)', 'transparent']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.bar, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Close reader">
          <ChevronLeftIcon color="#fff" />
        </Pressable>
        <View style={styles.titles}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            {title}
          </ThemedText>
          <ThemedText type="small" numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </ThemedText>
        </View>
        {/* Right spacer balances the back button so the titles stay centred. */}
        <View style={styles.back} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  back: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    maxWidth: '100%',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
});
