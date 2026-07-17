/**
 * A small circular progress ring for a download. Shown while a download is in progress (a completed
 * one shows no ring); tone follows the state (accent while downloading, muted otherwise, danger when
 * failed). The progress arc is ANIMATED — it eases to each new value (reanimated `strokeDashoffset`)
 * rather than jumping, so page-by-page progress reads as a smoothly growing ring.
 */
import { useEffect } from 'react';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';
import type { DownloadState } from '@comical/downloads';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function DownloadRadial({
  fraction,
  state,
  size = 22,
  strokeWidth = 2.5,
}: {
  /** Progress in [0,1]. */
  fraction: number;
  state: DownloadState;
  size?: number;
  strokeWidth?: number;
}) {
  const theme = useTheme();
  const color = state === 'failed' ? theme.danger : state === 'downloading' ? theme.accent : theme.textSecondary;

  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;

  // Ease the arc to each new fraction. strokeDasharray is the full circumference; the animated
  // strokeDashoffset hides the unfilled remainder (offset = circumference → empty, 0 → full).
  const progress = useSharedValue(Math.max(0, Math.min(1, fraction)));
  useEffect(() => {
    progress.value = withTiming(Math.max(0, Math.min(1, fraction)), { duration: 400 });
  }, [fraction, progress]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.value) }));

  return (
    <Svg width={size} height={size}>
      {/* Track */}
      <Circle cx={cx} cy={cx} r={r} stroke={theme.hairline} strokeWidth={strokeWidth} fill="none" />
      {/* Progress arc, starting at 12 o'clock */}
      <AnimatedCircle
        cx={cx}
        cy={cx}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        animatedProps={animatedProps}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
      />
    </Svg>
  );
}
