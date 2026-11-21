/**
 * `vertical-bar-edge` reports the side of the screen UIKit lays its bars down as a column on
 * (`UITraitCollection.verticalBarEdge`, iOS 27.1), from a zero-size view in the page: `leading` or
 * `trailing` where the bars stand beside the content (a phone on its side, the iPhone Duo),
 * `unspecified` where they run along the top and bottom.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed). It reports
 * nothing before iOS 27.1.
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type VerticalBarEdge = 'leading' | 'trailing' | 'unspecified';

export type VerticalBarEdgeProbeProps = ViewProps & {
  onEdge?: (event: { nativeEvent: { edge: VerticalBarEdge } }) => void;
};

export const VerticalBarEdgeProbe: ComponentType<VerticalBarEdgeProbeProps> | null = requireOptionalNativeModule(
  'VerticalBarEdge',
)
  ? requireNativeView<VerticalBarEdgeProbeProps>('VerticalBarEdge')
  : null;
