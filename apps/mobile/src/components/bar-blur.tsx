import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';

import { useActiveColorScheme } from '@/hooks/use-theme';

/**
 * The TWO knobs for every bar in the app. The top bars (via `BarSurface`) and the bottom tab bar all
 * render this component, so they are tuned by the same values and cannot drift apart. Tune here and
 * nowhere else.
 *
 * They do different jobs, and it's worth being precise because the names mislead:
 *
 * `BAR_BLUR_INTENSITY` (0–100) is the blur RADIUS, not an opacity. It controls how badly the content
 * behind is *smeared* — high values make what's underneath unrecognisable, low values leave it sharp
 * (at 0 the layer is effectively clear glass). Raising this hides the content behind MORE.
 *
 * `BAR_TINT_OPACITY` (0–1) is the actual opacity: a flat scrim of the bar's own background colour laid
 * over the blur. This is what "how solid is the bar" means. The blur alone can't get you there — a
 * heavy blur still shows big blocks of colour bleeding through (a bright cover under the bar tints it)
 * — so the scrim is what makes the bar read as a *surface* the content passes behind, and what keeps
 * the bar's own text legible over busy artwork.
 *
 * Together: blur it hard enough that shapes dissolve, then lay enough scrim over it that only a hint
 * of motion/colour survives.
 */
const BAR_BLUR_INTENSITY = 65;
const BAR_TINT_OPACITY = 0.42;

/**
 * Frosted background for the app's top and bottom bars — an absolute-fill layer placed BEHIND a
 * bar's own content (so drop the bar's solid `backgroundColor` and render this first). Matches iOS's
 * translucent bars: content scrolls under and shows through the blur.
 *
 * iOS + web get a real blur (iOS via the native `UIVisualEffectView`, which is what the OS uses for
 * its own bars — cheap even over a scrolling list; web via `backdrop-filter`). Android falls back to
 * a solid fill: its blur is the experimental Dimezis path, which is costly to recompute every frame
 * under a fast-scrolling grid and would reintroduce scroll jank on the always-present bars.
 */
export function BarBlur({ fallback }: { fallback: string }) {
  const scheme = useActiveColorScheme();
  if (Platform.OS === 'android') {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fallback }]} />;
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <BlurView
        tint={scheme === 'dark' ? 'dark' : 'light'}
        intensity={BAR_BLUR_INTENSITY}
        style={StyleSheet.absoluteFill}
      />
      {/* The opacity scrim, over the blur — see BAR_TINT_OPACITY. Flat colour, so unlike the blur it
          samples nothing: it looks identical on every bar regardless of what's behind them, which is
          also what stops two adjacent bars' blurs from reading as obviously different surfaces. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fallback, opacity: BAR_TINT_OPACITY }]} />
    </View>
  );
}
