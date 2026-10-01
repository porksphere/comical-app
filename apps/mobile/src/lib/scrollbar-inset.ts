import { Platform, type ViewStyle } from 'react-native';

/**
 * Where a scroller's scrollbar track starts, for a shell that draws one — the desktop app's
 * `::-webkit-scrollbar-track` reads it. Screens overlay their top bar (and a pinned heading, where
 * they have one) on the content, and a thumb running up under them is hidden by them. Give it the
 * height of whatever covers THIS scroller, so the track starts where the content stops being covered.
 *
 * A custom property on the scroller is the only thing that reaches its scrollbar's pseudo-elements.
 * It inherits, so it goes on the scroller itself — never on an ancestor of other scrollers.
 */
export function scrollbarInset(top: number): ViewStyle | undefined {
  return Platform.OS === 'web' ? ({ '--scrollbar-inset-top': `${top}px` } as ViewStyle) : undefined;
}
