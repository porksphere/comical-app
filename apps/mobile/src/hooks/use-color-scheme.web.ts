import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * `hydrated` is module-scoped (shared by every caller) rather than per-component
 * state: the very first client render must emit the same 'light' the static
 * export prerendered (or React warns and reflows), but once the app has hydrated
 * any component mounted *later* — e.g. chapter rows rebuilt on a sort/tab change
 * — should read the real scheme immediately instead of repeating the light→dark
 * flash on its own mount.
 */
let hydrated = false;

export function useColorScheme() {
  const [isHydrated, setIsHydrated] = useState(hydrated);

  useEffect(() => {
    hydrated = true;
    setIsHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  return isHydrated ? colorScheme : 'light';
}
