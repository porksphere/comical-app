import { createContext } from 'react';
import type { ViewStyle } from 'react-native';

/**
 * The hover rail a web row's actions reveal in: the delete/edit buttons of `SwipeableRow` and the
 * grip of `ReorderableList`, drawn OVER the row's trailing end on hover rather than in lanes beside
 * it — so a row is full width at rest, its chevron at the edge exactly as on native, and nothing
 * is held open for buttons that aren't showing.
 *
 * Covering the trailing end only works if what sits there is decorative, and if the row stays lit
 * while the pointer is on the rail (a sibling of the row, so the row's own hover ends there). Both
 * go through this context: whoever owns the hover region — the reorderable row when there is one,
 * else the actions row — publishes `hovered`, and the settings row under it highlights on that and
 * fades its trailing slot out as the rail fades in. `inset` is how much of the right edge an outer
 * rail (the grip lane) already holds, so an inner one stacks beside it.
 *
 * Never provided on native, and not by a row whose actions sit beside it (`SwipeableRow` without
 * `overlay`): with no provider the settings row is exactly what it always was.
 */
export type HoverRail = {
  hovered: boolean;
  inset: number;
};

export const HoverRailContext = createContext<HoverRail | null>(null);

/** The fade the rail's buttons, the grip and the covered trailing slot share. react-native-web maps
 *  these onto the div so a toggle eases; they aren't RN `ViewStyle`, hence the cast. Web only. */
export const HOVER_RAIL_FADE = {
  transitionProperty: 'opacity',
  transitionDuration: '120ms',
} as unknown as ViewStyle;
