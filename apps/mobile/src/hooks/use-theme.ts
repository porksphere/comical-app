/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';

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
type ColorScheme = 'light' | 'dark';

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
 * call). Because this resolves the app-wide theme (via `ThemeSchemeProvider`),
 * that surfaced as React's "Rendered fewer hooks than expected" crash: an
 * error-boundary screen on iOS/Android, and on the web static export a hydration
 * desync that blanked the page entirely.
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

/** `[preference, setPreference]` — the current appearance choice and its setter (for the Settings picker). */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  return [useThemePreferenceValue(), setThemePreference];
}

/**
 * Resolve the active scheme from the preference + OS. Called in exactly one
 * place — `ThemeSchemeProvider`, at the app root — so the preference/OS reads
 * (and their hydration transition) happen once, not in every themed component.
 */
function useResolvedColorScheme(): ColorScheme {
  const osScheme = useColorScheme();
  const preference = useThemePreferenceValue();
  if (preference === 'light' || preference === 'dark') return preference;
  return osScheme === 'dark' ? 'dark' : 'light';
}

// The resolved scheme, computed once at the root and handed down via context, so
// the many `useTheme` consumers each do a single cheap context read instead of
// re-resolving (and re-subscribing to) the preference + OS scheme themselves.
// This is value *distribution*, not a third state owner — `themePreference$`
// (Legend State) stays the single source of truth (see AGENTS.md "State"). The
// `'light'` default matches the SSR / pre-hydration scheme, so a stray consumer
// mounted outside the provider degrades to the same first-paint theme instead of
// throwing.
const SchemeContext = createContext<ColorScheme>('light');

/**
 * Resolves the active color scheme once and provides it to the whole tree. Mount
 * at the app root, above every `useTheme`/`useActiveColorScheme` consumer.
 */
export function ThemeSchemeProvider({ children }: { children: ReactNode }) {
  const scheme = useResolvedColorScheme();
  return createElement(SchemeContext.Provider, { value: scheme }, children);
}

/** The active color scheme, read from context (resolved once by `ThemeSchemeProvider`). */
export function useActiveColorScheme(): ColorScheme {
  return useContext(SchemeContext);
}

export function useTheme() {
  return Colors[useActiveColorScheme()];
}
