import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

/** One section's vertical extent in the feed's content space: its heading from `top`, its body
 *  from `bodyTop`. */
export type FeedBand = { top: number; bodyTop: number; bottom: number };

// Placeholder colours, walked in feed order. Ordered so neighbours sit far apart on the hue wheel:
// a feed of two or three sections is the common one, and adjacent hues there read as one colour.
const PALETTE = ['#4F8DFD', '#E0569B', '#F2A03D', '#2FC4B2', '#9A6CF6', '#F2664F', '#57C96B', '#3FB2E8'];

const WASH = { dark: 0.16, light: 0.1 };
const GLOW = { dark: 0.34, light: 0.2 };

const GLOW_HEIGHT = 1.7;
const GLOW_WIDTH = 0.7;
// Where each glow's centre sits across the feed, kept near the middle: a glow run off the side of
// the screen is cut by it, and a cut glow reads as a clipped shape rather than as light.
const GLOW_X = [0.42, 0.58, 0.47, 0.6, 0.4, 0.54];
// Sideways travel per point of scroll, alternate glows in opposite directions. Each is on its own
// `GLOW_X` as its section crosses the middle of the screen. Sideways only: a glow that also
// travelled down the page at its own rate was off its rail everywhere but that one moment.
const GLOW_SWAY = 0.07;

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

  const scroll = useAnimatedStyle(() => ({ transform: [{ translateY: -scrollOffset.value }] }));
  const swayRight = useAnimatedStyle(() => ({ transform: [{ translateX: scrollOffset.value * GLOW_SWAY }] }));
  const swayLeft = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollOffset.value * GLOW_SWAY }] }));
  const fade = useAnimatedStyle(() => ({ transform: [{ translateY: barOffset?.value ?? 0 }] }));

  if (bands.length === 0) return null;

  const color = (i: number) => PALETTE[i % PALETTE.length]!;
  // The BODY's middle, not the band's: the colour belongs behind the covers, and a band's own
  // middle is pulled up toward its heading. A band cut off at its heading has no body yet.
  const mid = (b: FeedBand) => Math.round((Math.min(b.bodyTop, b.bottom) + b.bottom) / 2);
  const first = bands[0]!;
  const last = bands[bands.length - 1]!;

  // Knots at each body's middle, so a rail sits on its own colour and the blend happens across the
  // seam between two. The ends ramp from and to nothing.
  const knots = [
    { y: Math.round(first.top), color: rgba(color(0), 0) },
    ...bands.map((b, i) => ({ y: mid(b), color: rgba(color(i), WASH[scheme]) })),
    { y: Math.round(last.bottom), color: rgba(color(bands.length - 1), 0) },
  ];

  const glows = (parity: 0 | 1) =>
    bands.map((b, i) => {
      if (i % 2 !== parity) return null;
      const height = Math.max(0, b.bottom - b.bodyTop) * GLOW_HEIGHT;
      // The layer's sway at the scroll that puts this band mid-screen, taken back out.
      const home = (parity === 0 ? -1 : 1) * GLOW_SWAY * (mid(b) - viewport / 2);
      return (
        <View
          key={i}
          style={[
            styles.glow,
            {
              top: mid(b) - height / 2,
              height,
              left: `${(GLOW_X[i % GLOW_X.length]! - GLOW_WIDTH / 2) * 100}%`,
              transform: [{ translateX: home }],
            },
            glowStyle(color(i), GLOW[scheme]),
          ]}
        />
      );
    });

  return (
    <Animated.View pointerEvents="none" style={[styles.clip, style]}>
      <Animated.View style={[styles.sheet, scroll]}>
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
        <Animated.View style={[styles.sheet, swayRight]}>{glows(0)}</Animated.View>
        <Animated.View style={[styles.sheet, swayLeft]}>{glows(1)}</Animated.View>
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
  glow: {
    position: 'absolute',
    width: `${GLOW_WIDTH * 100}%`,
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
