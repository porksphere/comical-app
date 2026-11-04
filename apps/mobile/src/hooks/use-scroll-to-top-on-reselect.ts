import type { LegendListRef } from '@legendapp/list/react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { FlatList, ScrollViewInstance } from 'react-native';

import { registerScrollToTop } from '@/lib/reselect-scroll';

// LegendList and FlatList both expose `scrollToOffset`; ScrollView uses `scrollTo`. The
// `'scrollToOffset' in node` check below narrows between them at runtime.
type Scrollable = FlatList<unknown> | LegendListRef | ScrollViewInstance;

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

/**
 * The same registration for a list reached some other way than a ref — a native list scrolled
 * through its own call — and for a screen that is only sometimes a tab root (`routeName`
 * undefined elsewhere: nothing is registered). The latest `scrollToTop` is the one called.
 */
export function useReselectScrollToTop(routeName: string | undefined, scrollToTop: () => void) {
  const latest = useRef(scrollToTop);
  useEffect(() => {
    latest.current = scrollToTop;
  });
  useFocusEffect(
    useCallback(() => {
      if (!routeName) return;
      return registerScrollToTop(routeName, () => latest.current());
    }, [routeName]),
  );
}
