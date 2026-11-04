import { createContext, useState, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaListener } from 'react-native-safe-area-context';
import { BarScrolledProvider } from '@/components/bar-scrolled';

/**
 * How far down the screen its native bar reaches, status bar included, while the bar slides away
 * on scroll (`SLIDE_AWAY_BAR` in lib/native-bar): null outside a screen that measures it.
 *
 * The height the stack reports for the bar follows the bar out, frame by frame, and content padded
 * by it would ride along under the finger. The screen's safe area holds still instead: UIKit puts
 * a transparent bar into the safe area of the view under it, and the sliding bar is told to leave
 * that alone. So the top of the safe area, as UIKit has it for this screen, is the full bar,
 * through a rotation, a fold and a tab that lays out its bar only once it is shown.
 */
export const BarExtentContext = createContext<number | null>(null);

type LayoutArgs = {
  options: { unstable_nativeProps?: { headerConfig?: { minimizationBehavior?: string } } };
  children: ReactElement;
};

/**
 * A stack's `screenLayout`: a screen registered with the sliding bar measures it — see
 * `BarExtentContext`. Decided by the options the screen starts with, so options a page sets on
 * itself later can't add or drop the measuring view under it, which would remount the page.
 */
export function barExtentLayout({ options, children }: LayoutArgs): ReactElement {
  const slides = options.unstable_nativeProps?.headerConfig?.minimizationBehavior === 'onScrollDown';
  // Context only, no view: UIKit's search for the list is not deepened by it (see BarExtent).
  return (
    <BarScrolledProvider>
      <BarExtent slides={slides}>{children}</BarExtent>
    </BarScrolledProvider>
  );
}

function BarExtent({ slides, children }: { slides: boolean; children: ReactElement }) {
  const [measured] = useState(slides);
  const [top, setTop] = useState<number | null>(null);
  if (!measured) return children;
  // Beside the page, never around it: UIKit finds the list the bar follows by itself, and on a
  // device one wrapper more around the list was enough to stop the bar sliding.
  return (
    <BarExtentContext.Provider value={top}>
      {children}
      <SafeAreaListener
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onChange={({ insets }) => setTop(insets.top)}
      />
    </BarExtentContext.Provider>
  );
}
