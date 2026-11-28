import { Platform } from 'react-native';

import { useIsSidebarTabRoot } from '@/hooks/use-content-width';

/** Glass needs a backdrop blur, which only the web has for a plain view. */
export const GLASS_BLUR = Platform.OS === 'web';

/**
 * Whether this screen's top bar is the desktop's: bare over the page, its title and controls in
 * glass capsules, beside the floating sidebar. Only on a tab's own screen, where that sidebar is
 * the nav and the blur exists; everywhere else a bar is the opaque `BarSurface`.
 */
export function useGlassChrome(): boolean {
  const tabRoot = useIsSidebarTabRoot();
  return GLASS_BLUR && tabRoot;
}
