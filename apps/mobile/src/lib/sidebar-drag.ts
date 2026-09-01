/**
 * The rail's LIVE width, as a Reanimated shared value, so the edge tracks the pointer on the UI
 * thread while the committed width lags behind it.
 *
 * The split exists because the two can't move at the same rate. The rail is ours to animate; the
 * content's inset is a `paddingLeft` on `TabSlot`, which renders react-native-screens'
 * `ScreenContainer` — not an animated component — so it can only change through a React render.
 * Committing one of those per frame relayouts a virtualized grid sixty times a second.
 *
 * So the edge reads this every frame, and the commit happens only when the column count would
 * actually change (see `sidebar-resizer`) — a handful of renders across a drag instead of hundreds.
 *
 * Module-level and mutable, the same shape `tab-bar-slide` uses for the bottom bar's slide, and for
 * the same reason: nothing here re-renders anything.
 */
import { makeMutable } from 'react-native-reanimated';

import { SidebarWidth } from '@/constants/theme';

/** Kept in step with the committed width whenever a drag ISN'T running — see `app-tabs`. */
export const sidebarDragWidth = makeMutable(SidebarWidth);

/** Written through a function rather than by assigning `.value` at the call site: a module-level
 *  mutable is exactly what `react-hooks/immutability` refuses to let a component write to directly,
 *  and the same shape `tab-bar-slide` uses for the bottom bar. `worklet` so a gesture can call it on
 *  the UI thread without a hop. */
export function setSidebarDragWidth(next: number): void {
  'worklet';
  sidebarDragWidth.value = next;
}
