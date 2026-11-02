import { Slot } from 'expo-router';

/** Off iOS a tab is just its screen, which draws its own TabTitleBar; the native stack is iOS's (tab-stack.ios). */
export default function TabStack(_: { tab: string }) {
  return <Slot />;
}
