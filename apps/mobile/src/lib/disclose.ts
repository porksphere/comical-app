import { Easing } from 'react-native-reanimated';

/** The one timing every open/close disclosure in the app uses — the sidebar's groups, a chapter's
 *  versions — so a thing that unfolds does it at one speed wherever it is. */
export const DISCLOSE_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) };
