/**
 * `content-scroll-view` tells the screen's view controller which list under it is its content, so
 * the navigation bar can follow a list UIKit wouldn't find for itself. See `ScreenScrollMarker`.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export const ContentScrollAnchor: ComponentType<ViewProps & { active?: boolean }> | null =
  requireOptionalNativeModule('ContentScrollView') ? requireNativeView('ContentScrollView') : null;
