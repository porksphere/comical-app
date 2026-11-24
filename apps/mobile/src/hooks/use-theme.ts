/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { use$ } from '@legendapp/state/react';
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SystemUI from 'expo-system-ui';
import { Appearance, Platform } from 'react-native';

import { MATERIAL_SEED, paletteFromMaterial, PURE_BLACK_ROLES } from '@/constants/material';
import { Colors, type Palette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMaterialRoles, WALLPAPER_COLORS_AVAILABLE } from '@/lib/material-colors';
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

/**
 * Android's two choices over its Material palette: whether it is drawn from the wallpaper (Android
 * 12 and later; otherwise, and when off, from the app's blue), and whether the dark theme's page is
 * black where Material's is a tinted near-black.
 */
type MaterialPrefs = { wallpaper: boolean; pureBlack: boolean };
const DEFAULT_MATERIAL: MaterialPrefs = { wallpaper: true, pureBlack: false };
const materialPrefs$ = persisted$<MaterialPrefs>('comical:materialTheme', DEFAULT_MATERIAL);

// Read at the root the way the theme preference is, and for its reason.
function useMaterialPrefsValue(): MaterialPrefs {
  const [prefs, setPrefs] = useState<MaterialPrefs>(DEFAULT_MATERIAL);
  useEffect(() => {
    const sync = () => setPrefs({ ...DEFAULT_MATERIAL, ...materialPrefs$.peek() });
    sync();
    return materialPrefs$.onChange(sync);
  }, []);
  return prefs;
}

/** Whether the wallpaper's colours can be offered at all: an Android device that draws them. */
export const WALLPAPER_COLORS = WALLPAPER_COLORS_AVAILABLE;

export function useWallpaperColors(): boolean {
  return use$(materialPrefs$.wallpaper) ?? DEFAULT_MATERIAL.wallpaper;
}

export function setWallpaperColors(enabled: boolean): void {
  materialPrefs$.wallpaper.set(enabled);
}

export function usePureBlack(): boolean {
  return use$(materialPrefs$.pureBlack) ?? DEFAULT_MATERIAL.pureBlack;
}

export function setPureBlack(enabled: boolean): void {
  materialPrefs$.pureBlack.set(enabled);
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
function useResolvedColorScheme(preference: ThemePreference): ColorScheme {
  const osScheme = useColorScheme();
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
const PaletteContext = createContext<Palette>(Colors.light);

/** What a Jetpack Compose host is themed with, so it draws from the palette `useTheme` hands the
 *  React Native views around it. */
export type MaterialHostTheme = {
  colorScheme: ColorScheme;
  seedColor: string | undefined;
  colorOverrides: typeof PURE_BLACK_ROLES | undefined;
};
const MaterialHostContext = createContext<MaterialHostTheme>({
  colorScheme: 'light',
  seedColor: undefined,
  colorOverrides: undefined,
});

/**
 * Resolves the active color scheme once and provides it to the whole tree. Mount
 * at the app root, above every `useTheme`/`useActiveColorScheme` consumer.
 *
 * On iOS the preference is also pushed down to the WINDOW (`Appearance.setColorScheme`
 * = `overrideUserInterfaceStyle`). Everything the system draws for the app — the
 * Liquid Glass tab and navigation bars, their toolbar capsules, menus, alerts, the
 * keyboard — takes its light or dark from the window's style, not from what is
 * drawn under it: a dark app on a light device got a white glass bar over its
 * dark lists. `'unspecified'` hands the window back to the device for `'system'`.
 * Android's window takes it for the same reason: the system bars' glyphs, the keyboard and a
 * Compose host left to itself all follow the window's night mode.
 *
 * On Android the palette is Material's (constants/material), drawn from the wallpaper or the app's
 * blue and mapped onto the same token names, so every `useTheme` consumer follows it unchanged.
 */
export function ThemeSchemeProvider({ children }: { children: ReactNode }) {
  const preference = useThemePreferenceValue();
  const scheme = useResolvedColorScheme(preference);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);
  const { wallpaper, pureBlack } = useMaterialPrefsValue();
  const fromWallpaper = wallpaper && WALLPAPER_COLORS_AVAILABLE;
  const roles = useMaterialRoles(scheme, wallpaper);
  const black = pureBlack && scheme === 'dark';
  const palette = useMemo<Palette>(
    () => (roles ? paletteFromMaterial(roles, Colors[scheme], black) : Colors[scheme]),
    [roles, scheme, black],
  );
  const hostTheme = useMemo<MaterialHostTheme>(
    () => ({
      colorScheme: scheme,
      seedColor: fromWallpaper ? undefined : MATERIAL_SEED,
      colorOverrides: black ? PURE_BLACK_ROLES : undefined,
    }),
    [scheme, fromWallpaper, black],
  );
  // The window and root view in the theme's background: whatever isn't drawn yet as the window
  // changes size — an iPhone Duo folding or opening — shows that, not the root view's own white or
  // black, picked from the trait when it was made. On Android it is what shows behind a screen
  // sliding in and under the keyboard as it rises.
  const background = palette.background;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void SystemUI.setBackgroundColorAsync(background);
  }, [background]);
  return createElement(
    SchemeContext.Provider,
    { value: scheme },
    createElement(
      PaletteContext.Provider,
      { value: palette },
      createElement(MaterialHostContext.Provider, { value: hostTheme }, children),
    ),
  );
}

/** The active color scheme, read from context (resolved once by `ThemeSchemeProvider`). */
export function useActiveColorScheme(): ColorScheme {
  return useContext(SchemeContext);
}

export function useTheme(): Palette {
  return useContext(PaletteContext);
}

export function useMaterialHostTheme(): MaterialHostTheme {
  return useContext(MaterialHostContext);
}
