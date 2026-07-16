/**
 * The per-row download status control: a progress radial with the state's glyph in the centre
 * (download / queued-clock / pause / fail-triangle), tappable to perform the contextual manual action
 * — pause an in-flight or queued download, resume a paused one, retry a failed one. Used on both
 * series and chapter rows; a completed download shows no indicator (the row shows a chevron instead).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { DownloadRadial } from '@/components/downloads/download-radial';
import { DownloadingIcon, FailedIcon, PauseIcon, QueuedIcon } from '@/components/icons/ui-icons';
import { useTheme } from '@/hooks/use-theme';
import type { DownloadState } from '@comical/downloads';

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
  /**
   * When true (chapter rows), the whole indicator is a button for the manual action. When false
   * (series rows — whose ROW is already a Pressable to expand), it's rendered visual-only to avoid a
   * button-inside-a-button (invalid on web); the series' pause/resume/retry stays on the swipe actions.
   */
  interactive?: boolean;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const glyphSize = Math.round(size * 0.5);
  const color = state === 'failed' ? theme.danger : state === 'downloading' ? theme.accent : theme.textSecondary;

  const glyph =
    state === 'failed' ? (
      <FailedIcon color={color} size={glyphSize} />
    ) : state === 'paused' ? (
      <PauseIcon color={color} size={glyphSize} />
    ) : state === 'queued' ? (
      <QueuedIcon color={color} size={glyphSize} />
    ) : (
      <DownloadingIcon color={color} size={glyphSize} />
    );

  const inner = (
    <>
      <DownloadRadial fraction={fraction} state={state} size={size} />
      <View style={styles.glyph} pointerEvents="none">
        {glyph}
      </View>
    </>
  );

  if (!interactive) {
    return <View style={[styles.wrap, { width: size, height: size }]}>{inner}</View>;
  }

  const { onPress, label } =
    state === 'failed'
      ? { onPress: onRetry, label: 'Retry download' }
      : state === 'paused'
        ? { onPress: onResume, label: 'Resume download' }
        : { onPress: onPause, label: 'Pause download' };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.wrap, { width: size, height: size }]}>
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  glyph: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
