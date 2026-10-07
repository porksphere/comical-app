import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

/**
 * Two progress bars stacked into ONE pill: the top and bottom halves fill independently, and the
 * outline stays a single rounded bar whatever the two values are. Each end of the pill is a
 * semicircle split between the halves, so a half on its own ends in a quarter-circle and two full
 * halves close into one plain pill. Where one half runs further than the other, the step between
 * them is a concave quarter-circle in the longer half's colour, laid UNDER the shorter half so the
 * shorter one's rounded end flows into it — the longer bar laps over the end of the shorter one
 * rather than meeting it at a right angle.
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

  // Top half: left quarter up from the midline, flat run, right quarter back down to the midline.
  const topPath = a > 0 ? `M0,${r} A${r},${r} 0 0 1 ${r},0 H${a - r} A${r},${r} 0 0 1 ${a},${r} Z` : undefined;
  // Bottom half, mirrored.
  const bottomPath = b > 0 ? `M0,${r} H${b} A${r},${r} 0 0 1 ${b - r},${h} H${r} A${r},${r} 0 0 1 0,${r} Z` : undefined;
  // The fillet in the step: a block of the longer half's colour over the shorter half's end, minus
  // the quarter-disc that gives the step its concave curve. Only when both are drawn — a lone half
  // is a plain half-pill with nothing to step down to. A step shorter than the radius would carry
  // the curve past the longer half's own end, so there the arc stops where that half does.
  let fillet: { d: string; color: string } | undefined;
  if (a > 0 && b > 0 && a !== b) {
    const short = Math.min(a, b);
    const long = Math.max(a, b);
    const end = Math.min(short + r, long);
    // Depth of the quarter-circle (centred on the shorter half's outer edge at short + r) at `end`.
    const depth = Math.sqrt(r * r - (short + r - end) ** 2);
    if (b > a) {
      // Bottom runs further: the fillet sits in the top half, curving from (a,0) down toward (a+r,r).
      fillet = { d: `M${a - r},0 H${a} A${r},${r} 0 0 0 ${end},${depth} V${r} H${a - r} Z`, color: bottomColor };
    } else {
      // Top runs further: mirrored into the bottom half, curving from (b,h) up toward (b+r,r).
      fillet = { d: `M${b - r},${h} H${b} A${r},${r} 0 0 1 ${end},${h - depth} V${r} H${b - r} Z`, color: topColor };
    }
  }

  return (
    <View style={[styles.box, { width, height: h }, style]} testID={testID}>
      <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
        <Defs>
          {/* The pill is the clip, so a fillet poking past the far end can never leave the outline. */}
          <ClipPath id={clipId}>
            <Rect x={0} y={0} width={width} height={h} rx={r} ry={r} />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#${clipId})`}>
          <Rect x={0} y={0} width={width} height={h} fill={trackColor} />
          {fillet && <Path d={fillet.d} fill={fillet.color} />}
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
