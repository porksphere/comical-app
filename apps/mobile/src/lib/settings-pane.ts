/**
 * "This screen is being rendered as a pane inside the settings modal, not as a route."
 *
 * The modal reuses the settings SCREENS rather than reimplementing them, so the one thing that has
 * to change is their chrome: a screen renders its own `TopBar` with a back button, which inside a
 * pane would be a second header under the modal's own and a back button pointing at a navigation
 * stack the pane isn't on. A context is the right shape because the screens are route components —
 * they take no props, so there is nothing to pass down.
 */
import { createContext, useContext } from 'react';

export const SettingsPaneContext = createContext(false);

export const useInSettingsPane = (): boolean => useContext(SettingsPaneContext);
