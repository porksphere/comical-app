import { usePathname } from 'expo-router';
import { useCallback } from 'react';

import { setSearchIntent } from '@/data/search-intent';
import { COMICAL_BRIDGE_ID } from '@/data/selected-bridge';
import { useRouter } from '@/lib/nav';
import { closeSeriesPane } from '@/lib/series-pane';
import { closeSettingsModal } from '@/lib/settings-modal';

/**
 * Opens Search across every bridge — the desktop's Search entry and its Ctrl+K.
 *
 * Always the Comical aggregate, never Browse's bridge: from Library or History there is no bridge you
 * are "in", and a shortcut that searched whichever one Browse was last left on would answer a
 * different question depending on where you'd been. Browse's own search button still inherits.
 *
 * Already on Search, it re-points that screen rather than stacking a second one over it.
 */
export function useOpenComicalSearch(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    closeSettingsModal();
    closeSeriesPane();
    setSearchIntent({ bridgeId: COMICAL_BRIDGE_ID, kind: 'open' });
    if (pathname !== '/search') router.push('/search');
  }, [router, pathname]);
}
