/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useEffect, useState } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { persisted$ } from '@/lib/observable';

/**
 * The user's appearance preference: follow the device OS (`'system'`), or force
 * one scheme everywhere. Persisted device-local via Legend State (see
 * `lib/observable.ts`) so the choice survives an app restart.
 *
 * `Colors` (see `constants/theme.ts`) defines both palettes and every surface
 * reads them through `useTheme`, so all three modes are fully wired: `'light'`
 * and `'dark'` pin that palette, `'system'` follows `useColorScheme()`.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'comical:themePreference';
const DEFAULT_PREFERENCE: ThemePreference = 'system';

// Persisted preference store. Written via `setThemePreference`, read reactively
// through `useThemePreferenceValue` below (deliberately NOT via `use$` — see it).
const themePreference$ = persisted$<ThemePreference>(STORAGE_KEY, DEFAULT_PREFERENCE);

/** Set the appearance preference; persists and re-themes every mounted screen. */
export function setThemePreference(preference: ThemePreference): void {
  themePreference$.set(preference);
}

/**
 * Read the persisted preference **without** Legend State's `use$`.
 *
 * `use$` reads a persisted store through `useSyncExternalStore`, and on a store
 * that hydrates from AsyncStorage it can call a *different number of hooks*
 * across renders (its selector read can bail out before the `useSyncExternalStore`
 * call). Because `useActiveColorScheme` (below) runs at the app root — through
 * `useTheme`, on every screen, both platforms — that surfaced as React's
 * "Rendered fewer hooks than expected" crash: an error-boundary screen on
 * iOS/Android, and on the web static export a hydration desync that blanked the
 * page entirely.
 *
 * So we read the store the plain way instead: seed the SSR-safe default, then in
 * an effect (which never runs during SSR and runs post-hydration on the client)
 * adopt the rehydrated value and subscribe via `onChange` so a later change
 * still re-themes live. Fixed hook count, and the first client render stays
 * identical to the server — matching the guard `use-color-scheme.web.ts` uses.
 * On native there is no hydration step, so adoption is effectively immediate.
 */
function useThemePreferenceValue(): ThemePreference {
  const [preference, setPreference] = useState<ThemePreference>(DEFAULT_PREFERENCE);
  useEffect(() => {
    const sync = () => setPreference(themePreference$.peek());
    sync(); // adopt the rehydrated value now that we're past SSR/hydration
    return themePreference$.onChange(sync); // and keep in sync with later changes
  }, []);
  return preference;
}

/** `[preference, setPreference]` — the current appearance choice and its setter. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  return [useThemePreferenceValue(), setThemePreference];
}

/** The active color scheme: the forced palette if the preference pins one, else the device OS scheme. */
export function useActiveColorScheme(): 'light' | 'dark' {
  const osScheme = useColorScheme();
  const preference = useThemePreferenceValue();
  if (preference === 'light' || preference === 'dark') return preference;
  return osScheme === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  return Colors[useActiveColorScheme()];
}
