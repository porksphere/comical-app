import { useColorScheme as useRNColorScheme } from 'react-native';

import { useHydrated } from '@/hooks/use-responsive';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * The prerender has no `prefers-color-scheme` to read, so the first (hydrating) render must match the
 * light scheme the static HTML was built with; the real scheme applies from the render after. Shares
 * the app's one hydration signal (`useHydrated`) rather than keeping its own effect-driven copy.
 */
export function useColorScheme() {
  const hydrated = useHydrated();
  const colorScheme = useRNColorScheme();

  return hydrated ? colorScheme : 'light';
}
