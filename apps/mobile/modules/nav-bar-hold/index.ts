/**
 * `nav-bar-hold` — reports a press held on a screen's iOS large navigation title. The large
 * title is UIKit's own text, with no view of the app's to take a gesture, so `NavBarHold` (a
 * zero-size view in the page) reads the bar's touches instead and reports a press that begins
 * on the title's label, and its end: the lift, a drag away, or the system cancelling it. See
 * `native-tab-header`, which feeds the phases to the screen's ramped hold.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type NavBarHoldPhase = 'begin' | 'end';

export type NavBarHoldProps = ViewProps & {
  onHold?: (event: { nativeEvent: { phase: NavBarHoldPhase } }) => void;
  /** A beat of the hold's ramp: each new `pulseSeq` swells the title's label by `pulseAmount`
   *  (a scale above 1) and lets it settle, the way the custom marks pulse. */
  pulseSeq?: number;
  pulseAmount?: number;
};

export const NavBarHold: ComponentType<NavBarHoldProps> | null = requireOptionalNativeModule('NavBarHold')
  ? requireNativeView<NavBarHoldProps>('NavBarHold')
  : null;
