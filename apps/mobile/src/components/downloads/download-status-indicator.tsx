/**
 * The per-row download status control.
 *
 * The visual is EXCLUSIVE by state — never a ring with an icon on top:
 *   - downloading → the progress radial only (the ring is the progress),
 *   - queued      → the clock icon only,
 *   - paused      → the pause icon only,
 *   - failed      → the alert icon only,
 *   - complete    → the downloaded (check) icon only.
 *
 * `DownloadStatusIndicator` wraps that visual in a Pressable for the manual action — pause an
 * in-flight/queued download, resume a paused one, retry a failed one — on chapter rows. On series rows
 * it's rendered non-interactive (the row is already pressable to expand — avoids a button-in-button on
 * web); the series' actions stay on its swipe menu. The bare `DownloadStateVisual` is reused wherever
 * only the glyph is wanted (e.g. the series Download button).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { DownloadRadial } from '@/components/downloads/download-radial';
import { DownloadedIcon, FailedIcon, PauseIcon, QueuedIcon } from '@/components/icons/ui-icons';
import { useTheme } from '@/hooks/use-theme';
import type { DownloadState } from '@comical/downloads';

/** The exclusive state visual: a progress ring while downloading, else the state's icon. */
export function DownloadStateVisual({
  state,
  fraction,
  size = 22,
  strokeWidth = 2.5,
}: {
  state: DownloadState;
  fraction: number;
  size?: number;
  strokeWidth?: number;
}) {
  const theme = useTheme();
  if (state === 'downloading') {
    return <DownloadRadial fraction={fraction} state={state} size={size} strokeWidth={strokeWidth} />;
  }
  if (state === 'failed') return <FailedIcon color={theme.danger} size={size} />;
  if (state === 'paused') return <PauseIcon color={theme.textSecondary} size={size} />;
  if (state === 'queued') return <QueuedIcon color={theme.textSecondary} size={size} />;
  return <DownloadedIcon color={theme.textSecondary} size={size} />; // complete — kept offline
}

export function DownloadStatusIndicator({
  state,
  fraction,
  size = 22,
  interactive = true,
  onPause,
  onResume,
  onRetry,
}: {
  state: DownloadState;
  fraction: number;
  size?: number;
  /** When false (series rows, whose ROW is already a button), render visual-only — no nested button. */
  interactive?: boolean;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
}) {
  const visual = (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <DownloadStateVisual state={state} fraction={fraction} size={size} />
    </View>
  );

  // No action for a completed download — render the check as a plain (non-pressable) marker.
  if (!interactive || state === 'complete') return visual;

  const { onPress, label } =
    state === 'failed'
      ? { onPress: onRetry, label: 'Retry download' }
      : state === 'paused'
        ? { onPress: onResume, label: 'Resume download' }
        : { onPress: onPause, label: 'Pause download' };

  return (
    <Pressable testID="download.status-action" onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={styles.wrap}>
      {visual}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
});
