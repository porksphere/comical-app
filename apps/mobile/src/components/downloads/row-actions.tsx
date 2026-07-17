/**
 * The download rows' action logic — ONE source of truth for which verbs apply to which state,
 * consumed by both presentations so they cannot drift:
 *  - the swipe/hover actions on rows (Downloads screen series rows, per-series chapter rows), and
 *  - the select-mode pill bar's bulk verbs (`chapterCan` / `seriesCan`).
 *
 * The verb rules:
 *  - Delete applies to what's SETTLED on disk — complete, paused, or failed. An actively
 *    downloading row deliberately has no delete: pause it first, then delete.
 *  - Cancel (an X, not a trash can) applies to a QUEUED chapter — nothing on disk yet to "delete";
 *    for a series it covers the whole in-flight range (downloading or queued), where it discards
 *    the incomplete chapters and keeps the finished ones.
 *  - Pause applies while in flight (downloading/queued); Resume to paused; Retry to failed.
 *
 * Swipe layout: actions are laid out left→right and the LAST one sits at the swipe edge (revealed
 * FIRST). So the primary action (Pause/Resume/Retry) goes LAST (nearest the edge), and the
 * destructive one (Cancel/Delete) goes FIRST — you reach Pause with a short swipe, the destructive
 * action only with a longer one.
 */
import { ClearIcon, PauseIcon, PlayIcon, RetryIcon, TrashIcon } from '@/components/icons/ui-icons';
import type { SwipeRowAction } from '@/components/settings/swipeable-row';
import type { DownloadState } from '@comical/downloads';

export interface RowHandlers {
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  /** Discard the in-flight download (series: drop the incomplete chapters; chapter: drop the queued entry). */
  onCancel: () => void;
  onDelete: () => void;
}

/** Which verbs apply to a CHAPTER in a given state (see the module docstring for the rules). */
export const chapterCan = {
  delete: (s: DownloadState) => s === 'complete' || s === 'paused' || s === 'failed',
  cancel: (s: DownloadState) => s === 'queued',
  pause: (s: DownloadState) => s === 'downloading' || s === 'queued',
  resume: (s: DownloadState) => s === 'paused',
  retry: (s: DownloadState) => s === 'failed',
} as const;

/** Which verbs apply to a SERIES in a given rolled-up state. */
export const seriesCan = {
  delete: (s: DownloadState) => s === 'complete' || s === 'paused' || s === 'failed',
  cancel: (s: DownloadState) => s === 'downloading' || s === 'queued',
  pause: (s: DownloadState) => s === 'downloading' || s === 'queued',
  resume: (s: DownloadState) => s === 'paused',
  retry: (s: DownloadState) => s === 'failed',
} as const;

const PAUSE = (onPress: () => void): SwipeRowAction => ({ label: 'Pause', icon: PauseIcon, onPress });
const RESUME = (onPress: () => void): SwipeRowAction => ({ label: 'Resume', icon: PlayIcon, onPress });
const RETRY = (onPress: () => void): SwipeRowAction => ({ label: 'Retry', icon: RetryIcon, onPress });
const CANCEL = (onPress: () => void): SwipeRowAction => ({ label: 'Cancel', icon: ClearIcon, destructive: true, onPress });
const DELETE = (onPress: () => void): SwipeRowAction => ({ label: 'Delete', icon: TrashIcon, destructive: true, onPress });

/** A chapter row's swipe actions — derived from `chapterCan`, so the pill bar always agrees. */
export function chapterActions(state: DownloadState, h: RowHandlers): SwipeRowAction[] {
  const out: SwipeRowAction[] = [];
  if (chapterCan.cancel(state)) out.push(CANCEL(h.onCancel));
  else if (chapterCan.delete(state)) out.push(DELETE(h.onDelete));
  if (chapterCan.resume(state)) out.push(RESUME(h.onResume));
  else if (chapterCan.retry(state)) out.push(RETRY(h.onRetry));
  else if (chapterCan.pause(state)) out.push(PAUSE(h.onPause));
  return out;
}

/** A series row's swipe actions — derived from `seriesCan`, so the pill bar always agrees. */
export function seriesActions(state: DownloadState, h: RowHandlers): SwipeRowAction[] {
  const out: SwipeRowAction[] = [];
  if (seriesCan.cancel(state)) out.push(CANCEL(h.onCancel));
  else if (seriesCan.delete(state)) out.push(DELETE(h.onDelete));
  if (seriesCan.resume(state)) out.push(RESUME(h.onResume));
  else if (seriesCan.retry(state)) out.push(RETRY(h.onRetry));
  else if (seriesCan.pause(state)) out.push(PAUSE(h.onPause));
  return out;
}
