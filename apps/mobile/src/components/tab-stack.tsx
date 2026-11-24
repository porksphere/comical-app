import { Slot } from 'expo-router';

import { BarScrolledProvider } from '@/components/bar-scrolled';

/**
 * Off iOS a tab is just its screen, which draws its own TabTitleBar; the native stack is iOS's
 * (tab-stack.ios). Each tab keeps its own bar-scrolled state: the tabs are one screen of the root
 * stack, and one tab's list is not under another's bar.
 */
export default function TabStack(_: { tab: string }) {
  return (
    <BarScrolledProvider>
      <Slot />
    </BarScrolledProvider>
  );
}
