/**
 * "This screen is being rendered as a pane inside the settings modal, not as a route."
 *
 * The modal reuses the settings SCREENS rather than reimplementing them, so three things have to be
 * answered differently in here, and all three are answered by context because the screens are route
 * components — they take no props, so there is nothing to pass down.
 *
 * - Their `TopBar` stands down: inside a pane it would be a second header under the modal's own.
 * - `useSettingsScrollPadding` stops reserving room for that bar and for a tab bar.
 * - Pushing a sub-page stays INSIDE the pane instead of navigating the app to a full-screen route,
 *   and the pushed screen reads its params from the pane rather than from the URL — which is the
 *   part that makes this more than a styling switch (see `useLocalSearchParams` in `lib/nav`).
 */
import { createContext, useContext } from 'react';

export const SettingsPaneContext = createContext(false);

export const useInSettingsPane = (): boolean => useContext(SettingsPaneContext);

export type PaneParams = Record<string, string | undefined>;

export type PaneNav = {
  /** Returns true when the pane took the navigation, false to let it go to the router. */
  push: (pathname: string, params: PaneParams) => boolean;
  /** Returns true when the pane popped something, false to let `back` reach the router. */
  back: () => boolean;
  /** The params of whatever the pane is currently showing. */
  params: PaneParams;
};

export const SettingsPaneNavContext = createContext<PaneNav | null>(null);

export const useSettingsPaneNav = (): PaneNav | null => useContext(SettingsPaneNavContext);
