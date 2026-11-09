import { DownloadedIcon, DownloadingIcon, FailedIcon, PauseIcon, QueuedIcon } from '@/components/icons/ui-icons';
import type { SettingsIcon } from '@/components/settings/settings-form';
import type { DownloadState } from '@comical/downloads';

/** A download's state as a settings row's leading glyph, in both languages (`SettingsIcon`), bare:
 *  a state, not the thing's picture. */
export const DOWNLOAD_STATE_ICON: Record<DownloadState, SettingsIcon> = {
  downloading: { symbol: 'arrow.down.circle', glyph: (color, size) => <DownloadingIcon color={color} size={size} />, bare: true },
  queued: { symbol: 'clock', glyph: (color, size) => <QueuedIcon color={color} size={size} />, bare: true },
  paused: { symbol: 'pause.circle', glyph: (color, size) => <PauseIcon color={color} size={size} />, bare: true },
  failed: { symbol: 'exclamationmark.triangle', glyph: (color, size) => <FailedIcon color={color} size={size} />, bare: true },
  complete: { symbol: 'checkmark.circle', glyph: (color, size) => <DownloadedIcon color={color} size={size} />, bare: true },
};

/** A chapter not downloaded, beside the ones that are. */
export const NOT_DOWNLOADED_ICON: SettingsIcon = {
  symbol: 'arrow.down.to.line',
  glyph: (color, size) => <DownloadingIcon color={color} size={size} />,
  bare: true,
};
