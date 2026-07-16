/**
 * A small circular progress ring for a download's state — shown on Downloads-screen rows and the
 * series Download button while a download is in progress. Callers should render it only when NOT
 * complete (a finished download shows no ring). Tone follows the state: accent while downloading,
 * muted while queued/paused, danger when failed. A paused ring carries a small centre bar so it reads
 * as "paused" at a glance.
 */
import Svg, { Circle, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';
import type { DownloadState } from '@comical/downloads';

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
  const clamped = Math.max(0, Math.min(1, fraction));
  const dash = clamped * circumference;

  return (
    <Svg width={size} height={size}>
      {/* Track */}
      <Circle cx={cx} cy={cx} r={r} stroke={theme.hairline} strokeWidth={strokeWidth} fill="none" />
      {/* Progress arc, starting at 12 o'clock */}
      <Circle
        cx={cx}
        cy={cx}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      {/* Paused glyph — a small centred bar pair. */}
      {state === 'paused' && (
        <>
          <Rect x={cx - 3} y={cx - 3.5} width={2} height={7} rx={1} fill={color} />
          <Rect x={cx + 1} y={cx - 3.5} width={2} height={7} rx={1} fill={color} />
        </>
      )}
    </Svg>
  );
}
