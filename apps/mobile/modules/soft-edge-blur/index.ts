/**
 * `soft-edge-blur` — a blur that fades out down its height, the look of iOS 26's soft scroll-edge
 * effect, for a bar over content that is never scrolled under it: the system draws its own only
 * over a scroll view's content scrolled beneath the bar, which a sideways pager never is. It is the
 * system's dark material (a UIVisualEffectView) under a gradient mask, so a white title stays
 * legible over a white page in either theme. `visible` animates the blur in or out; never fade the
 * view or anything holding it, which UIKit renders wrongly.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type SoftEdgeBlurProps = ViewProps & {
  /** Whether the blur is up; a change animates it in or out. */
  visible: boolean;
};

export const SoftEdgeBlur: ComponentType<SoftEdgeBlurProps> | null = requireOptionalNativeModule('SoftEdgeBlur')
  ? requireNativeView<SoftEdgeBlurProps>('SoftEdgeBlur')
  : null;
