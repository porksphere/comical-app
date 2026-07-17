/**
 * The download rows' swipe/hover action sets, shared by the Downloads screen (series rows) and the
 * per-series download screen (chapter rows) so the two can't drift.
 *
 * Actions are laid out left→right and the LAST one sits at the swipe edge (revealed FIRST). So the
 * primary action (Pause/Resume/Retry) goes LAST (nearest the edge), and the destructive one
 * (Cancel/Delete) goes FIRST (further to the left) — you reach Pause with a short swipe, the
 * destructive action only with a longer one.
 */
import { ClearIcon, PauseIcon, PlayIcon, RetryIcon, TrashIcon } from '@/components/icons/ui-icons';
import type { SwipeRowAction } from '@/components/settings/swipeable-row';
import type { DownloadState } from '@comical/downloads';

export interface RowHandlers {
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  /** Discard the in-flight download (series: drop the incomplete chapters; chapter: delete it). */
  onCancel: () => void;
  onDelete: () => void;
}

const PAUSE = (onPress: () => void): SwipeRowAction => ({ label: 'Pause', icon: PauseIcon, onPress });
const RESUME = (onPress: () => void): SwipeRowAction => ({ label: 'Resume', icon: PlayIcon, onPress });
const RETRY = (onPress: () => void): SwipeRowAction => ({ label: 'Retry', icon: RetryIcon, onPress });
const CANCEL = (onPress: () => void): SwipeRowAction => ({ label: 'Cancel', icon: ClearIcon, destructive: true, onPress });
const DELETE = (onPress: () => void): SwipeRowAction => ({ label: 'Delete', icon: TrashIcon, destructive: true, onPress });

/** Series swipe actions: while downloading you get Pause + Cancel (Cancel discards the in-flight
 *  downloads, after which the series is complete-only → Delete). */
export function seriesActions(state: DownloadState, h: RowHandlers): SwipeRowAction[] {
  if (state === 'complete') return [DELETE(h.onDelete)];
  if (state === 'paused') return [DELETE(h.onDelete), RESUME(h.onResume)];
  if (state === 'failed') return [DELETE(h.onDelete), RETRY(h.onRetry)];
  return [CANCEL(h.onCancel), PAUSE(h.onPause)]; // downloading / queued
}

/** Chapter swipe actions: a chapter is atomic, so its destructive action is always Delete. */
export function chapterActions(state: DownloadState, h: RowHandlers): SwipeRowAction[] {
  if (state === 'complete') return [DELETE(h.onDelete)];
  if (state === 'paused') return [DELETE(h.onDelete), RESUME(h.onResume)];
  if (state === 'failed') return [DELETE(h.onDelete), RETRY(h.onRetry)];
  return [DELETE(h.onDelete), PAUSE(h.onPause)]; // downloading / queued
}
