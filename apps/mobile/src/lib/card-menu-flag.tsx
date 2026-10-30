import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * Developer A/B (Settings › Developer, iOS): series cards hold @expo/ui's SwiftUI context menu
 * (series-card-menu-swiftui.tsx) instead of the system menu module, to compare scrolling on a
 * device. Off by default. An object rather than a bare boolean, for the reason `lightCards$` gives.
 */
export const swiftUICardMenu$ = persisted$('comical:dev-swiftui-card-menu', { enabled: false });

export function useSwiftUICardMenuSetting(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => swiftUICardMenu$.enabled.onChange(onStoreChange),
    () => swiftUICardMenu$.enabled.peek(),
    () => swiftUICardMenu$.enabled.peek(),
  );
}

const SwiftUICardMenuContext = createContext(false);

/**
 * Root-mounted (app/_layout.tsx): the one subscription to the setting. Cards read it through
 * context, so none of them subscribes to the store, and with it off a card pays one context read.
 */
export function SwiftUICardMenuProvider({ children }: { children: ReactNode }) {
  const enabled = useSwiftUICardMenuSetting();
  return <SwiftUICardMenuContext value={enabled}>{children}</SwiftUICardMenuContext>;
}

export function useSwiftUICardMenu(): boolean {
  return useContext(SwiftUICardMenuContext);
}
