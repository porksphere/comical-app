import { useSelector } from '@legendapp/state/react';
import { useIsFocused } from 'expo-router';
import { createContext, useState, type ReactElement } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaListener } from 'react-native-safe-area-context';
import { BarScrolledProvider } from '@/components/bar-scrolled';
import { logDiagnostic } from '@/lib/diagnostics';
import { persisted$ } from '@/lib/observable';

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

/**
 * The bar's extent at each window size, measured once and kept: a screen is padded by it from its
 * first frame. Until its own measure lands, a frame or two after it is shown, a screen has only the
 * stack's default height, the standard 44pt bar, and the iOS 27 bar is taller: the content popped
 * down by the difference on every first visit to a tab, and a list that holds its rows in place
 * over a padding change was left scrolled by that much. The tabs all mount at launch, before any
 * bar is measured, so the store is what a hidden tab takes the measure from. The shown screen's
 * measure stands; one from a screen that isn't (a tab not yet laid out under its bar) only if it is
 * larger, since a bar not laid out measures short. Kept across launches for the first screen's sake.
 */
const barExtents$ = persisted$<Record<string, number>>('comical:barExtents', {});

function BarExtent({ slides, children }: { slides: boolean; children: ReactElement }) {
  const [measured] = useState(slides);
  const { width, height } = useWindowDimensions();
  const pose = `${width}x${height}`;
  // `useSelector`, not `use$`: the React Compiler knows a hook by its name and `use$` isn't one to
  // it, so it memoized the read on the window size and skipped it on the next render, which React
  // throws on (fewer hooks than expected), and the app never left its splash.
  const top = useSelector(barExtents$[pose]) ?? null;
  const focused = useIsFocused();
  if (!measured) return children;
  // Beside the page, never around it: UIKit finds the list the bar follows by itself, and on a
  // device one wrapper more around the list was enough to stop the bar sliding.
  return (
    <BarExtentContext.Provider value={top}>
      {children}
      <SafeAreaListener
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onChange={({ insets }) => {
          const known = barExtents$[pose].peek();
          // TEMPORARY: each measure to Settings > Diagnostics, until the tabs' first frame is confirmed.
          logDiagnostic('bar-extent', `${pose} ${focused ? 'shown' : 'hidden'}: ${insets.top} (had ${known ?? 'none'})`);
          if (focused || known == null || insets.top > known) barExtents$[pose].set(insets.top);
        }}
      />
    </BarExtentContext.Provider>
  );
}
