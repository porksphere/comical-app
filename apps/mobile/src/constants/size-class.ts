/**
 * The app's two size classes, and the navigation each one gets.
 *
 * Pure functions of a width, with no React and no `react-native` import, so they can be unit-tested
 * and called from a worklet (`sidebar-resizer`). The hooks that read the live viewport live in
 * `hooks/use-responsive`.
 *
 * Apple's guidance for the iPhone Duo (and iPadOS before it) is to design for exactly two horizontal
 * size classes rather than for devices or poses: COMPACT is a phone and the Duo's outer display;
 * REGULAR is the Duo's inner display (890×626pt), a foldable's inner panel (a Galaxy Z Fold 8 is
 * 816×616dp), a tablet, and a desktop window. Everything that used to compare a width against 768
 * directly now asks `sizeClassFor` instead, so the threshold — and the vocabulary — lives in one place.
 */
export type SizeClass = 'compact' | 'regular';

/** Width at which the layout becomes REGULAR: the series detail goes two-column, the browse grid
 *  stops being the three-column phone grid, rails become grids, the top bar takes its taller form.
 *  768 is iPad-portrait's logical width and lands a Duo's Split View half (≈445pt) and the Duo's
 *  outer display (678pt) firmly in compact. */
export const RegularWidthBreakpoint = 768;

export const sizeClassFor = (width: number): SizeClass => (width >= RegularWidthBreakpoint ? 'regular' : 'compact');

/**
 * Where the navigation sits at a width.
 *
 * - `bar`: the bottom tab bar. Every compact width.
 * - `rail`: the side navigation, forced to its icon-only collapsed form (`SidebarCollapsedWidth`).
 *   Regular width that is still narrower than `SidebarBreakpoint`: a Duo or Fold inner display, an
 *   iPad in portrait. The screen is wide but SHORT there (a Fold's inner panel is 616dp tall), so a
 *   bottom bar costs a row of covers while a 64dp rail costs a sliver of width the grid barely
 *   notices — and it is the "tab bar becomes a sidebar on the inner display" layout Apple describes.
 *   Collapsed by force rather than by preference because a labelled sidebar would eat into content
 *   that hasn't reached its max width (see `SidebarBreakpoint`).
 * - `sidebar`: the labelled, resizable sidebar, collapsible at the user's choice.
 *
 * `web` is a parameter rather than a `Platform` read so this stays pure. Web keeps the bottom bar
 * between 768 and `SidebarBreakpoint` for now: a browser window that narrow is a resized desktop
 * window, not a device, and the web-only layouts that ride on the sidebar (series as a pane, settings
 * as a modal, search in the rail) were designed for the labelled rail's width. Lift that gate here
 * when they are ready for it, nowhere else.
 */
export type NavMode = 'bar' | 'rail' | 'sidebar';

/**
 * `MaxTopLevelWidth - 160` (see `constants/theme`), not a round number picked by eye: below it the
 * labelled sidebar would eat into content that hasn't yet reached its max width, so the grid loses a
 * column to gain a nav rail. Above it the content column is already capped and the sidebar takes
 * space the page was leaving as margin anyway. Spelled out here because this module must not import
 * `theme` (which imports the app's CSS and `react-native`); `theme` re-exports it.
 */
export const SidebarBreakpoint = 1200 - 160;

export const navModeFor = (width: number, web: boolean): NavMode => {
  if (width >= SidebarBreakpoint) return 'sidebar';
  if (!web && sizeClassFor(width) === 'regular') return 'rail';
  return 'bar';
};
