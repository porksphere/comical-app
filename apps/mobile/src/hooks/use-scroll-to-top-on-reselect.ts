import { useFocusEffect } from 'expo-router';
import { useCallback, type RefObject } from 'react';
import type { FlatList, ScrollView } from 'react-native';

import { registerScrollToTop } from '@/lib/reselect-scroll';

type Scrollable = FlatList<unknown> | ScrollView;

/**
 * While this screen is focused, registers it under `routeName` (matching `app-tabs.tsx`'s `TABS`
 * list) so tapping its already-active tab scrolls it to top.
 */
export function useScrollToTopOnReselect(routeName: string, ref: RefObject<Scrollable | null>) {
  useFocusEffect(
    useCallback(() => {
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
