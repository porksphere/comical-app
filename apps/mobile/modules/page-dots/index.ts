/**
 * `page-dots` is the system's page control (UIPageControl): a row of dots that says which of
 * several pages is showing. A tap either side of the dots steps a page and a drag along them
 * scrubs, both reported through `onPage`.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type NativePageDotsProps = ViewProps & {
  count: number;
  page: number;
  onPage?: (event: { nativeEvent: { page: number } }) => void;
};

export const NativePageDots: ComponentType<NativePageDotsProps> | null = requireOptionalNativeModule('PageDots')
  ? requireNativeView<NativePageDotsProps>('PageDots')
  : null;
