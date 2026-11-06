import { useSelector } from '@legendapp/state/react';
import { createContext, useEffect, useRef, useState, type ReactElement } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaListener } from 'react-native-safe-area-context';
import { BarScrolledProvider } from '@/components/bar-scrolled';
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
  route: { name: string };
  options: { unstable_nativeProps?: { headerConfig?: { minimizationBehavior?: string } } };
  children: ReactElement;
};

/**
 * A stack's `screenLayout`: a screen registered with the sliding bar measures it — see
 * `BarExtentContext`. Decided by the options the screen starts with, so options a page sets on
 * itself later can't add or drop the measuring view under it, which would remount the page.
 */
export function barExtentLayout({ route, options, children }: LayoutArgs): ReactElement {
  const slides = options.unstable_nativeProps?.headerConfig?.minimizationBehavior === 'onScrollDown';
  // Context only, no view: UIKit's search for the list is not deepened by it (see BarExtent).
  return (
    <BarScrolledProvider>
      <BarExtent slides={slides} root={route.name === 'index'}>
        {children}
      </BarExtent>
    </BarScrolledProvider>
  );
}

/**
 * A screen pads by its bar's extent from its first frame. Until its own measure lands, a frame or
 * two after it is shown, it has only the stack's default height, the standard 44pt bar, and the
 * iOS 27 bar is taller: the content popped down by the difference on every first visit to a tab,
 * and a list that holds its rows in place over a padding change was left scrolled by that much.
 * So the tab roots' settled measures are kept per window size (and iOS version, so a bar that
 * changes height with an update starts over; across launches for the first screen's sake), and a
 * screen without a measure of its own takes that: the tabs all mount at launch, before any bar is
 * measured. Only the roots feed it, since a pushed page's bar can be taller (a search page's, with
 * the field under it), and only their largest: a root's bar measures full for a frame and then
 * the strip alone once its items are taken into a folded or landscape display's vertical bar,
 * and its title sits on the full row either way, so a root pads by the larger of its own and
 * the store's. A pushed page's own measure stands over the seed once it has one: a larger one
 * at once (the bar arriving), a smaller one once settled, held for a moment (a dip as the bar
 * moves), and a bar not laid out, measuring nothing, never.
 */
const barExtents$ = persisted$<Record<string, number>>('comical:barExtents2', {});
const SETTLE_MS = 250;

function BarExtent({ slides, root, children }: { slides: boolean; root: boolean; children: ReactElement }) {
  const [measured] = useState(slides);
  const { width, height } = useWindowDimensions();
  const pose = `${Platform.Version}:${width}x${height}`;
  // `useSelector`, not `use$`: the React Compiler knows a hook by its name and `use$` isn't one to
  // it, so it memoized the read on the window size and skipped it on the next render, which React
  // throws on (fewer hooks than expected), and the app never left its splash.
  const seed = useSelector(barExtents$[pose]) ?? null;
  const [own, setOwn] = useState<{ pose: string; top: number } | null>(null);
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current);
    },
    [],
  );
  if (!measured) return children;
  const ownTop = own?.pose === pose ? own.top : null;
  const top = root ? (ownTop == null && seed == null ? null : Math.max(ownTop ?? 0, seed ?? 0)) : (ownTop ?? seed);
  const measure = (next: number) => {
    if (settling.current) clearTimeout(settling.current);
    settling.current = null;
    if (next <= 0) return;
    if (own?.pose !== pose || next > own.top) setOwn({ pose, top: next });
    if (root) {
      // A root's largest, at once: its bar collapses to the strip once its items are taken into a
      // vertical bar, and its title needs the full row either way.
      if ((barExtents$[pose].peek() ?? 0) < next) barExtents$[pose].set(next);
      return;
    }
    settling.current = setTimeout(() => setOwn({ pose, top: next }), SETTLE_MS);
  };
  // Beside the page, never around it: UIKit finds the list the bar follows by itself, and on a
  // device one wrapper more around the list was enough to stop the bar sliding.
  return (
    <BarExtentContext.Provider value={top}>
      {children}
      <SafeAreaListener pointerEvents="none" style={StyleSheet.absoluteFill} onChange={({ insets }) => measure(insets.top)} />
    </BarExtentContext.Provider>
  );
}
