import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** Auto-hiding top toolbar over the reader: back + the series title with its
 *  chapter beneath, and an optional trailing control (the reader's settings gear)
 *  on the right. The page counter is deliberately NOT here — the bottom chrome
 *  owns it on both platforms. */
export function ReaderToolbar({
  title,
  subtitle,
  visible,
  onBack,
  right,
  hideBack,
}: {
  title: string;
  subtitle: string;
  visible: boolean;
  onBack: () => void;
  /** Rendered in the slot opposite Back. Sized like the back button so the
   *  titles stay centred whether or not anything is passed. */
  right?: ReactNode;
  /** The screen renders its OWN back button persisting across bar modes (series-reader's
   *  TopBarSwitch) — keep just the spacer here so the titles stay centred. */
  hideBack?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: 200 }),
    transform: [{ translateY: withTiming(visible ? 0 : -8, { duration: 200 }) }],
  }));
  return (
    <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={[styles.wrap, style]}>
      <LinearGradient
        colors={['rgba(0,0,0,0.78)', 'transparent']}
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
      />
      <View style={[styles.bar, { paddingTop: insets.top + Spacing.two }]}>
        {hideBack ? (
          <View style={styles.back} />
        ) : (
          <Pressable
            testID="reader.toolbar.back"
            onPress={onBack}
            hitSlop={12}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Close reader">
            <ChevronLeftIcon color="#fff" />
          </Pressable>
        )}
        <View style={styles.titles}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            {title}
          </ThemedText>
          {!!subtitle && (
            <ThemedText type="small" numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </ThemedText>
          )}
        </View>
        {/* Balances the back button so the titles stay centred — with the
            trailing control in it when there is one, empty otherwise. */}
        <View style={styles.back}>{right}</View>
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
