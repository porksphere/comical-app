import type { MaterialRoles } from '@/constants/material';

/** Whether the device can draw a palette from its wallpaper (Android 12 and later). */
export const WALLPAPER_COLORS_AVAILABLE: boolean = false;

/** The device's Material palette. Android only: elsewhere there is none and the app's own stands. */
export function useMaterialRoles(_scheme: 'light' | 'dark', _wallpaper: boolean): MaterialRoles | null {
  return null;
}
