/**
 * `content-scroll-view` tells the screen's view controller which list under it is its content, so
 * the navigation bar can follow a list nested too deep for UIKit to find. See `TabScrollMarker`.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export const ContentScrollAnchor: ComponentType<ViewProps> | null = requireOptionalNativeModule('ContentScrollView')
  ? requireNativeView('ContentScrollView')
  : null;
