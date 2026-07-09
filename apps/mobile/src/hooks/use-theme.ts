/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { use$ } from '@legendapp/state/react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { persisted$ } from '@/lib/observable';

/**
 * The user's appearance preference: follow the device OS (`'system'`), or force
 * one scheme everywhere. Persisted device-local via Legend State (see
 * `lib/observable.ts`) so the choice survives an app restart, and read reactively
 * through `use$` so flipping it re-themes the whole app live.
 *
 * `Colors` (see `constants/theme.ts`) defines both palettes and every surface
 * reads them through `useTheme`, so all three modes are fully wired: `'light'`
 * and `'dark'` pin that palette, `'system'` follows `useColorScheme()`.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'comical:themePreference';
const DEFAULT_PREFERENCE: ThemePreference = 'system';

// Starts at DEFAULT_PREFERENCE (also the deterministic pre-hydration value the
// web static export renders) and rehydrates from AsyncStorage once it resolves.
const themePreference$ = persisted$<ThemePreference>(STORAGE_KEY, DEFAULT_PREFERENCE);

/** Set the appearance preference; persists and re-themes every mounted screen. */
export function setThemePreference(preference: ThemePreference): void {
  themePreference$.set(preference);
}

/** `[preference, setPreference]` — the current appearance choice and its setter. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  return [use$(themePreference$), setThemePreference];
}

/** The active color scheme: the forced palette if the preference pins one, else the device OS scheme. */
export function useActiveColorScheme(): 'light' | 'dark' {
  const osScheme = useColorScheme();
  const preference = use$(themePreference$);
  if (preference === 'light' || preference === 'dark') return preference;
  return osScheme === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  return Colors[useActiveColorScheme()];
}
