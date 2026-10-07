import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

/**
 * Two progress bars stacked into ONE pill: the top and bottom halves fill independently, and the
 * outline stays a single rounded bar whatever the two values are. Each end of the pill is a
 * semicircle split between the halves, so a half on its own ends in a quarter-circle and two full
 * halves close into one plain pill. Where one half stops short of the other it ends like a browser
 * tab instead: a convex corner on its outer edge, then a concave foot that flares along the midline
 * into the longer half. Each colour stays on its own side of the midline — the step is shaped
 * entirely by the shorter half's outline, never by a patch of the other colour.
 */
export function StackedProgress({
  width,
  barHeight,
  top,
  bottom,
  topColor,
  bottomColor,
  trackColor,
  style,
  testID,
}: {
  width: number;
  /** Height of EACH bar; the pill is twice this, and the corner radius equals it. */
  barHeight: number;
  /** 0–1 fill of the top bar. */
  top: number;
  /** 0–1 fill of the bottom bar. */
  bottom: number;
  topColor: string;
  bottomColor: string;
  trackColor: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  // useId's punctuation isn't legal in a url(#…) reference.
  const clipId = `sp${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const r = barHeight;
  const h = 2 * r;
  // A fill shorter than its two end arcs has no straight run between them; the smallest drawable
  // fill is the two arcs touching, so a started-but-tiny value shows as a nub rather than nothing.
  const span = (v: number) => (v <= 0 ? 0 : Math.max(2 * r, Math.min(width, v * width)));
  const a = span(top);
  const b = span(bottom);

  // Three ends. Equal or full halves take their quarter of the pill, so the outline closes. A half
  // that stops short ends like a browser tab: a convex corner then a concave foot, each half the
  // bar high and up to a full `r` wide (narrower only when the fill is too short to hold it), with
  // the foot's tip at the fill value so it never reaches past the longer half it flares into. The
  // longer half ends in its own semicircle rather than a quarter of the pill's, which would leave a
  // sharp corner against the midline where the other colour has already stopped.
  const q = r / 2;
  const tab = (v: number) => Math.min(r, (v - r) / 2);
  const topEnd =
    b > a
      ? `H${a - 2 * tab(a)} A${tab(a)},${q} 0 0 1 ${a - tab(a)},${q} A${tab(a)},${q} 0 0 0 ${a},${r}`
      : a > b && a < width
        ? `H${a - q} A${q},${q} 0 0 1 ${a - q},${r}`
        : `H${a - r} A${r},${r} 0 0 1 ${a},${r}`;
  const bottomEnd =
    a > b
      ? `H${b} A${tab(b)},${q} 0 0 0 ${b - tab(b)},${r + q} A${tab(b)},${q} 0 0 1 ${b - 2 * tab(b)},${h}`
      : b > a && b < width
        ? `H${b - q} A${q},${q} 0 0 1 ${b - q},${h}`
        : `H${b} A${r},${r} 0 0 1 ${b - r},${h}`;
  // Top half: left quarter up from the midline, flat run, its end back down to the midline.
  const topPath = a > 0 ? `M0,${r} A${r},${r} 0 0 1 ${r},0 ${topEnd} Z` : undefined;
  // Bottom half, mirrored: along the midline to its end, down and back along the bottom edge.
  const bottomPath = b > 0 ? `M0,${r} ${bottomEnd} H${r} A${r},${r} 0 0 1 0,${r} Z` : undefined;

  return (
    <View style={[styles.box, { width, height: h }, style]} testID={testID}>
      <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
        <Defs>
          {/* The pill is the clip, so a foot flaring at the far end can never leave the outline. */}
          <ClipPath id={clipId}>
            <Rect x={0} y={0} width={width} height={h} rx={r} ry={r} />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#${clipId})`}>
          <Rect x={0} y={0} width={width} height={h} fill={trackColor} />
          {topPath && <Path d={topPath} fill={topColor} />}
          {bottomPath && <Path d={bottomPath} fill={bottomColor} />}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
  },
});
