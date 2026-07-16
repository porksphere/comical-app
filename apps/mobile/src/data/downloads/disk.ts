/**
 * Device disk-space read for the Downloads screen's usage bar. The new expo-file-system exposes
 * synchronous `Paths.totalDiskSpace` / `Paths.availableDiskSpace`.
 *
 * Cross-platform reality: on **native (iOS/Android)** these report the real device volume, so
 * "downloads as a % of total disk" is accurate. On **web** a browser is sandboxed — there is no true
 * total-disk figure (at best an origin storage quota), so the value is unavailable/meaningless. We
 * report `usable: false` there and the bar degrades to just the downloaded size (no disk ratio).
 */
import { Paths } from 'expo-file-system';

export interface DiskInfo {
  /** Total device volume size in bytes. */
  total: number;
  /** Free space in bytes. */
  available: number;
  /** True only when the platform gives a real total-disk figure (native). */
  usable: boolean;
}

export function readDiskInfo(): DiskInfo {
  try {
    const total = Paths.totalDiskSpace;
    const available = Paths.availableDiskSpace;
    if (typeof total === 'number' && total > 0 && Number.isFinite(total)) {
      return { total, available: typeof available === 'number' ? available : 0, usable: true };
    }
  } catch {
    // web / unsupported — fall through to the unusable result
  }
  return { total: 0, available: 0, usable: false };
}
