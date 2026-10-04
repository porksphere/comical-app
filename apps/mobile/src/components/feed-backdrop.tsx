import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

/** One section's vertical extent in the feed's content space (a heading plus its body). */
export type FeedBand = { top: number; bottom: number };

// Placeholder colours, walked in feed order. Ordered so neighbours sit far apart on the hue wheel:
// a feed of two or three sections is the common one, and adjacent hues there read as one colour.
const PALETTE = ['#4F8DFD', '#E0569B', '#F2A03D', '#2FC4B2', '#9A6CF6', '#F2664F', '#57C96B', '#3FB2E8'];

const WASH = { dark: 0.16, light: 0.1 };
const GLOW = { dark: 0.34, light: 0.2 };

// The glows scroll slower than the rails they sit behind, about the viewport's centre: a rail
// meets its own glow as it crosses the middle of the screen and parts from it toward either edge.
const GLOW_DRIFT = 0.78;
const GLOW_HEIGHT = 2.1;
const GLOW_WIDTH = '85%';
// Where each glow's centre sits across the feed. Not a strict left/right alternation, which reads
// as a zip down the page.
const GLOW_X = [0.08, 0.9, 0.3, 0.98, 0.02, 0.72];

const CHROME_FADE = 72;

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// A linear ramp to nothing has a visible rim where it ends; these stops ease it out.
function glowImage(hex: string, alpha: number): string {
  return `radial-gradient(ellipse closest-side, ${rgba(hex, alpha)} 0%, ${rgba(hex, alpha * 0.62)} 30%, ${rgba(hex, alpha * 0.24)} 60%, ${rgba(hex, alpha * 0.06)} 82%, ${rgba(hex, 0)} 100%)`;
}

// react-native-web has no `experimental_backgroundImage`, and native has no `backgroundImage`.
function glowStyle(hex: string, alpha: number): ViewStyle {
  const image = glowImage(hex, alpha);
  return Platform.OS === 'web' ? ({ backgroundImage: image } as ViewStyle) : { experimental_backgroundImage: image };
}

/**
 * The feed's ambient colour: each section tints the page behind it, and one section's colour runs
 * into the next. Drawn BEHIND the list (which paints no background of its own) and moved by the
 * list's own scroll offset, so nothing here is in the list's rows or its recycling.
 */
export function FeedBackdrop({
  bands,
  scrollOffset,
  chromeBottom,
  barOffset,
  style,
}: {
  bands: FeedBand[];
  scrollOffset: SharedValue<number>;
  /** Screen-relative y of the bottom of whatever opaque chrome covers the top of the feed. The
   *  colour fades in below it rather than being cut off by its edge. */
  chromeBottom: number;
  barOffset?: SharedValue<number>;
  style?: Parameters<typeof Animated.View>[0]['style'];
}) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const { height: viewport } = useWindowDimensions();

  const wash = useAnimatedStyle(() => ({ transform: [{ translateY: -scrollOffset.value }] }));
  const glow = useAnimatedStyle(() => ({ transform: [{ translateY: -scrollOffset.value * GLOW_DRIFT }] }));
  const fade = useAnimatedStyle(() => ({ transform: [{ translateY: barOffset?.value ?? 0 }] }));

  if (bands.length === 0) return null;

  const color = (i: number) => PALETTE[i % PALETTE.length]!;
  const mid = (b: FeedBand) => Math.round((b.top + b.bottom) / 2);
  const first = bands[0]!;
  const last = bands[bands.length - 1]!;

  // Knots at each band's middle, so a rail sits on its own colour and the blend happens across the
  // seam between two. The ends ramp from and to nothing.
  const knots = [
    { y: Math.round(first.top), color: rgba(color(0), 0) },
    ...bands.map((b, i) => ({ y: mid(b), color: rgba(color(i), WASH[scheme]) })),
    { y: Math.round(last.bottom), color: rgba(color(bands.length - 1), 0) },
  ];

  return (
    <Animated.View pointerEvents="none" style={[styles.clip, style]}>
      <Animated.View style={[styles.sheet, wash]}>
        {knots.slice(1).map((to, i) => {
          const from = knots[i]!;
          return (
            <LinearGradient
              key={i}
              colors={[from.color, to.color]}
              style={[styles.span, { top: from.y, height: to.y - from.y }]}
            />
          );
        })}
      </Animated.View>
      <Animated.View style={[styles.sheet, glow]}>
        {bands.map((b, i) => {
          const height = (b.bottom - b.top) * GLOW_HEIGHT;
          // Laid out in the drifted space: at scroll `s` this lands `GLOW_DRIFT` of the way from
          // the viewport's centre to the band's own.
          const center = GLOW_DRIFT * mid(b) + (1 - GLOW_DRIFT) * (viewport / 2);
          return (
            <View
              key={i}
              style={[
                styles.glow,
                { top: center - height / 2, height, left: `${GLOW_X[i % GLOW_X.length]! * 100}%` },
                glowStyle(color(i), GLOW[scheme]),
              ]}
            />
          );
        })}
      </Animated.View>
      {/* Solid down to the chrome's edge, not just from it: at rest no heading is pinned yet, and
          the strip its band will cover would otherwise show colour that the fade then cuts off. */}
      <Animated.View style={[styles.fade, { height: chromeBottom + CHROME_FADE }, fade]}>
        <LinearGradient
          colors={[theme.background, theme.background, `${theme.background}00`]}
          locations={[0, chromeBottom / (chromeBottom + CHROME_FADE), 1]}
          style={styles.fill}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  span: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  // `left` places the CENTRE: the box is pulled back by half its own width.
  glow: {
    position: 'absolute',
    width: GLOW_WIDTH,
    marginLeft: '-42.5%',
  },
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  fill: {
    flex: 1,
  },
});
