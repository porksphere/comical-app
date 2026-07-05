import { useFocusEffect } from 'expo-router';
import { useCallback, type RefObject } from 'react';
import { Platform, type FlatList, type ScrollView } from 'react-native';

import { registerScrollToTop } from '@/lib/reselect-scroll';

type Scrollable = FlatList<unknown> | ScrollView;

/**
 * Web only: while this screen is focused, registers it under `routeName` (matching
 * `app-tabs.web.tsx`'s `TABS` list) so tapping its already-active tab scrolls it to top. No-op on
 * native, where `NativeTabs`' built-in repeated-tab-selection special effect already does this
 * (see the react-native-screens patch).
 */
export function useScrollToTopOnReselect(routeName: string, ref: RefObject<Scrollable | null>) {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web') return;
      return registerScrollToTop(routeName, () => {
        const node = ref.current;
        if (!node) return;
        if ('scrollToOffset' in node) node.scrollToOffset({ offset: 0, animated: true });
        else node.scrollTo({ y: 0, animated: true });
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeName]),
  );
}
