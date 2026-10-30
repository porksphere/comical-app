import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronUpIcon } from '@/components/icons/ui-icons';
import { BOTTOM_CHROME_HEIGHT, bottomChromeInset } from '@/components/reader/chapter-navigator';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const IS_WEB = Platform.OS === 'web';

/** The chrome's "Details" pill — the guaranteed, non-gesture way into the details card. Sits above
 *  the bottom chrome and fades with it. Needed because the cross-axis swipe can't always win:
 *  the web pager owns its whole touch surface, and an overflowing fit-width page's content-pan
 *  (rightly) takes vertical drags in paged mode. */
export function DetailsHint({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: 200 }),
  }));
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      // A gap above the bottom chrome's top edge: the navigator's on native, the progress pill's
      // on web (which has no page counter under it and so sits lower). On a direct series the
      // scrubber pill spans the whole width, straight under this, so the gap is what separates
      // the two backgrounds.
      style={[
        styles.detailsHintWrap,
        {
          bottom: IS_WEB
            ? insets.bottom + Spacing.two + 48
            : bottomChromeInset(insets.bottom) + BOTTOM_CHROME_HEIGHT + Spacing.two,
        },
        style,
      ]}>
      <Pressable
        testID="series-page.details"
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Show series details"
        style={styles.detailsHintPill}>
        {/* The chevron points where the READER goes — up and away, in both modes now. Webtoon
            pointed RIGHT back when its reveal was horizontal; the reveal is vertical everywhere
            since the drag-reveal was removed there, so the arrow was the last thing still
            describing the old motion. */}
        <ChevronUpIcon color="#fff" size={16} />
        <ThemedText type="small" style={styles.detailsHintLabel}>
          Details
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The two halves of the exiting card's shadow (see the render). Both hang off the OPAQUE
  // fill's right edge — `left: '100%'` inside headerSheetBg, which clips nothing (the seam
  // gradient already hangs above it the same way).
  detailsHintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  detailsHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  detailsHintLabel: {
    color: '#fff',
  },
});
