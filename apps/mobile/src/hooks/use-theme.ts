/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The app currently ships **dark-only**. Forcing a single scheme means the
 * static web export renders the same theme on the server and the client, so
 * there is no hydration color flash (the OS-driven path renders 'light' first,
 * then flips to the real scheme on mount — the source of the flicker).
 *
 * Theming is otherwise left fully wired for the future: `Colors` still defines
 * both palettes and every surface reads them through `useTheme`, so re-enabling
 * OS light/dark is just flipping this one switch:
 *   - `'dark'` / `'light'` — force that scheme everywhere.
 *   - `null` — follow the device OS color scheme (`useColorScheme`).
 * (If you set this back to `null`, also restore the responsive page background
 * in `src/app/+html.tsx`.)
 */
export const FORCED_COLOR_SCHEME: 'light' | 'dark' | null = 'dark';

/** The active color scheme: the forced override if set, else the device OS scheme. */
export function useActiveColorScheme(): 'light' | 'dark' {
  const osScheme = useColorScheme();
  if (FORCED_COLOR_SCHEME) return FORCED_COLOR_SCHEME;
  return osScheme === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  return Colors[useActiveColorScheme()];
}
