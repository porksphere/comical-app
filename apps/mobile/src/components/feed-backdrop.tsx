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

// The glow carries most of the colour and the wash the rest. The wash alone is a soft-edged
// rectangle, which reads as a panel; the glow alone is an ellipse, which leaves a rail's first and
// last rows bare. Weighted this way the whole is round, with the wash filling in toward the corners.
const WASH = { dark: 0.06, light: 0.04 };
const GLOW = { dark: 0.2, light: 0.13 };

// A section's colour is whole behind the middle of its covers and eases away over `BAND_RAMP` at
// either end, running `BAND_SPILL` past its own edge. Two sections' colours meet only in their
// last few percent, so the page between them dims without one colour becoming the other.
const BAND_RAMP = 220;
const BAND_SPILL = 56;
// The ramp as (distance along it, share of the colour): a smoothstep, since a straight ramp shows
// a rim at both of its ends.
const EASE = [
  [0, 0],
  [0.25, 0.16],
  [0.5, 0.5],
  [0.75, 0.84],
  [1, 1],
] as const;
// Of the feed's width, each side, over which the colour gives way to the page. It never reaches
// the screen's edge, where it would read as a shape the screen had cut.
const SIDE_FADE = 0.26;

// Against the section's body. Past its edges the glow is down to its last few percent, so it
// thins out over the neighbouring heading without colouring the neighbour's covers.
const GLOW_HEIGHT = 1.45;
const GLOW_WIDTH = 0.92;
const GLOW_X = [0.47, 0.53, 0.49, 0.54, 0.46, 0.51];
// Sideways travel per point of scroll, alternate glows in opposite directions. Each is on its own
// `GLOW_X` as its section crosses the middle of the screen. Sideways only: a glow that also
// travelled down the page at its own rate was off its rail everywhere but that one moment.
const GLOW_SWAY = 0.07;

const CHROME_FADE = 48;

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** `ramp` is the eased run at each end, as a share of the gradient's length (at most half). */
function bandStops(hex: string, alpha: number, ramp: number) {
  const up = EASE.map(([t, a]) => ({ at: t * ramp, color: rgba(hex, a * alpha) }));
  const stops = [...up, ...up.map((s) => ({ ...s, at: 1 - s.at })).reverse()];
  return {
    colors: stops.map((s) => s.color) as [string, string, ...string[]],
    locations: stops.map((s) => s.at) as [number, number, ...number[]],
  };
}

function glowImage(hex: string, alpha: number): string {
  const stops = [...EASE].reverse().map(([t, a]) => `${rgba(hex, a * alpha)} ${Math.round((1 - t) * 100)}%`);
  return `radial-gradient(ellipse closest-side, ${stops.join(', ')})`;
}

// react-native-web has no `experimental_backgroundImage`, and native has no `backgroundImage`.
function glowStyle(hex: string, alpha: number): ViewStyle {
  const image = glowImage(hex, alpha);
  return Platform.OS === 'web' ? ({ backgroundImage: image } as ViewStyle) : { experimental_backgroundImage: image };
}

/**
 * The feed's ambient colour: each section tints the page behind its own covers. Drawn BEHIND the
 * list (which paints no background of its own) and moved by the list's own scroll offset, so
 * nothing here is in the list's rows or its recycling.
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
  const clear = `${theme.background}00`;

  const glows = (parity: 0 | 1) =>
    bands.map((b, i) => {
      const body = b.bottom - b.bodyTop;
      if (i % 2 !== parity || body <= 0) return null;
      const mid = (b.bodyTop + b.bottom) / 2;
      const height = body * GLOW_HEIGHT;
      // The layer's sway at the scroll that puts this band mid-screen, taken back out.
      const home = (parity === 0 ? -1 : 1) * GLOW_SWAY * (mid - viewport / 2);
      return (
        <View
          key={i}
          style={[
            styles.glow,
            {
              top: mid - height / 2,
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
        {bands.map((b, i) => {
          if (b.bottom <= b.top) return null;
          const height = b.bottom - b.top + BAND_SPILL * 2;
          return (
            <LinearGradient
              key={i}
              {...bandStops(color(i), WASH[scheme], Math.min(0.5, BAND_RAMP / height))}
              style={[styles.span, { top: b.top - BAND_SPILL, height }]}
            />
          );
        })}
        <Animated.View style={[styles.sheet, swayRight]}>{glows(0)}</Animated.View>
        <Animated.View style={[styles.sheet, swayLeft]}>{glows(1)}</Animated.View>
      </Animated.View>
      {/* The page's own colour laid back over the sides: the same as fading the colour out, and it
          needs no mask, which native doesn't have. */}
      <LinearGradient
        colors={[theme.background, `${theme.background}66`, clear]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.side, styles.left]}
      />
      <LinearGradient
        colors={[clear, `${theme.background}66`, theme.background]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.side, styles.right]}
      />
      {/* Solid down to the chrome's edge, not just from it: at rest no heading is pinned yet, and
          the strip its band will cover would otherwise show colour that the fade then cuts off. */}
      <Animated.View style={[styles.fade, { height: chromeBottom + CHROME_FADE }, fade]}>
        <LinearGradient
          colors={[theme.background, theme.background, clear]}
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
  side: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: `${SIDE_FADE * 100}%`,
  },
  left: {
    left: 0,
  },
  right: {
    right: 0,
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
