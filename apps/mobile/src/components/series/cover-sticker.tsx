import { useIsFocused } from 'expo-router';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';

import { BURST_SIZE, BURST_TURN, BurstStar, StickerButton, stickerTone } from '@/components/sticker';
import { DeviceTilt, LEVEL, type Tilt } from '@/hooks/use-device-tilt';
import { useActiveColorScheme } from '@/hooks/use-theme';

const LEAN = -3;
const BURST_SCALE = 0.75;

/**
 * The trial (Settings → Developer): the home shelf's sticker hung on the series cover's lower
 * corner is what reads, with the new chapters' burst on the upper one, as on the shelf's front
 * book. Rendered inside the box that holds the cover.
 *
 * They stir with the device as the shelf's do, and as cheaply: the shelf's stickers are flat views
 * moved a few points by the tilt, not part of its scene, so there is nothing here to render in 3D.
 * The tilt is a shared value the two transforms read on the UI thread, so a reading renders
 * nothing in React and lays nothing out. A component of its own so that the sensor, which runs
 * while its hook is mounted, is on only while this page has the screen, and so that losing the
 * screen renders this and not the page's body.
 */
export function CoverSticker({
  label,
  where,
  newCount,
  wide,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  where: string;
  newCount?: number;
  /** Beside the page's other column, where there is less room to hang into. */
  wide: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const tone = stickerTone(useActiveColorScheme() === 'dark');
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const tilt = useSharedValue<Tilt>(LEVEL);
  const read = useAnimatedStyle(() => {
    const stir = tilt.get();
    return {
      transform: [{ translateX: stir.x * 4.5 }, { translateY: -stir.y * 3 }, { rotate: `${LEAN + stir.x * 2.25}deg` }],
    };
  });
  const burst = useAnimatedStyle(() => {
    const stir = tilt.get();
    return {
      transform: [
        { translateX: stir.x * 6.75 },
        { translateY: -stir.y * 4.5 },
        { scale: BURST_SCALE },
        { rotate: `${stir.x * 4.5}deg` },
      ],
    };
  });
  return (
    <>
      {focused && !reduceMotion && <DeviceTilt tilt={tilt} />}
      {newCount ? (
        <Animated.View pointerEvents="none" style={[styles.burst, burst]}>
          <BurstStar count={newCount} turn={BURST_TURN / 3} tone={tone} />
        </Animated.View>
      ) : null}
      <Animated.View style={[styles.read, wide && styles.readWide, read]}>
        <StickerButton
          testID="series.action.read"
          label={label}
          where={where}
          tone={tone}
          toneId="series-read-tone"
          accessibilityLabel={accessibilityLabel}
          onPress={onPress}
        />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  // Leaning off the cover's lower trailing corner, most of it on the cover.
  read: { position: 'absolute', right: -44, bottom: -18 },
  readWide: { right: -20 },
  burst: {
    position: 'absolute',
    left: -BURST_SIZE / 2 + 6,
    top: -BURST_SIZE / 2 + 10,
    width: BURST_SIZE,
    height: BURST_SIZE,
  },
});
