import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

/** One section's vertical extent in the feed's content space: its heading from `top`, its body
 *  from `bodyTop`. `tint` picks its colour — sections sharing one are the same colour. */
export type FeedBand = { top: number; bodyTop: number; bottom: number; tint: number };

// Placeholder colours, one per `tint`. Ordered so consecutive tints sit far apart on the hue wheel:
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
// Of the feed's width, each side, over which the colour gives way to the page. On a wide feed it
// never reaches the screen's edge, where it would read as a shape the screen had cut. A narrow one
// has no width to give up, and keeps only enough to soften that edge.
const SIDE_FADE = { narrow: 0.08, wide: 0.26 };
const NARROW_FEED = 480;
const WIDE_FEED = 960;

// Against the section's body. Past its edges the glow is down to its last few percent, so it
// thins out over the neighbouring heading without colouring the neighbour's covers.
const GLOW_HEIGHT = 1.45;
// A grid's body can be any length, and an ellipse that long is a stripe that shifts under the
// covers every time the grid loads more. Past this the glow is the ellipse's two halves with a
// straight run between them.
const GLOW_MAX_HEIGHT = 1100;
// Of the feed's width, and never under the floor: on a phone that is wider than the screen, so the
// colour runs off both sides as the rail over it does. A share of that width alone is a stripe
// down the middle.
const GLOW_WIDTH = 0.92;
const GLOW_MIN_WIDTH = 640;
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
  width,
  scrollOffset,
  chromeBottom,
  barOffset,
  style,
}: {
  bands: FeedBand[];
  /** The feed's own width, which is not the window's beside a sidebar. */
  width: number;
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

  const color = (tint: number) => PALETTE[tint % PALETTE.length]!;
  const clear = `${theme.background}00`;

  const glowWidth = Math.round(Math.max(width * GLOW_WIDTH, GLOW_MIN_WIDTH));
  const wideness = Math.min(1, Math.max(0, (width - NARROW_FEED) / (WIDE_FEED - NARROW_FEED)));
  const sideFade = width * (SIDE_FADE.narrow + (SIDE_FADE.wide - SIDE_FADE.narrow) * wideness);

  // A long glow is in neither swaying layer: its section is on screen for far more scroll than a
  // rail is, and would be carried clean off its covers.
  const glows = (layer: 0 | 1 | 'still') =>
    bands.map((b, i) => {
      const body = b.bottom - b.bodyTop;
      if (body <= 0) return null;
      const long = body * GLOW_HEIGHT > GLOW_MAX_HEIGHT;
      if (layer !== (long ? 'still' : i % 2)) return null;
      const left = Math.round((long ? 0.5 : GLOW_X[i % GLOW_X.length]!) * width - glowWidth / 2);
      const image = glowStyle(color(b.tint), GLOW[scheme]);
      if (!long) {
        const mid = (b.bodyTop + b.bottom) / 2;
        const height = body * GLOW_HEIGHT;
        // The layer's sway at the scroll that puts this band mid-screen, taken back out.
        const home = (layer === 0 ? -1 : 1) * GLOW_SWAY * (mid - viewport / 2);
        return (
          <View
            key={i}
            style={[
              styles.glow,
              { top: mid - height / 2, height, left, width: glowWidth, transform: [{ translateX: home }] },
              image,
            ]}
          />
        );
      }
      // Whole points throughout: the three pieces share edges, and a fraction between them is a line.
      const cap = GLOW_MAX_HEIGHT / 2;
      const over = Math.round((GLOW_MAX_HEIGHT - GLOW_MAX_HEIGHT / GLOW_HEIGHT) / 2);
      const top = Math.round(b.bodyTop) - over;
      const run = Math.max(0, Math.round(b.bottom) + over - top - cap * 2);
      return (
        <View key={i} style={[styles.glow, { top, left, width: glowWidth }]}>
          <View style={[styles.cap, { height: cap }]}>
            <View style={[{ height: cap * 2 }, image]} />
          </View>
          {/* The ellipse's own profile across its middle, so the run picks up where each half ends. */}
          <LinearGradient
            {...bandStops(color(b.tint), GLOW[scheme], 0.5)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: run }}
          />
          <View style={[styles.cap, { height: cap }]}>
            <View style={[{ height: cap * 2, marginTop: -cap }, image]} />
          </View>
        </View>
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
              {...bandStops(color(b.tint), WASH[scheme], Math.min(0.5, BAND_RAMP / height))}
              style={[styles.span, { top: b.top - BAND_SPILL, height }]}
            />
          );
        })}
        {glows('still')}
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
        style={[styles.side, styles.left, { width: sideFade }]}
      />
      <LinearGradient
        colors={[clear, `${theme.background}66`, theme.background]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.side, styles.right, { width: sideFade }]}
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
  },
  cap: {
    overflow: 'hidden',
  },
  side: {
    position: 'absolute',
    top: 0,
    bottom: 0,
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
