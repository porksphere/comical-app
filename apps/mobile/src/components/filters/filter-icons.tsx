import { StyleSheet, View } from 'react-native';

// Native icons for the filter bar. The web build uses lucide via the `.web.tsx`
// sibling (lucide-react is web-only); these hand-built glyphs are the RN
// fallback. Keep the two files' exports in sync.

export type IconProps = { color: string; size?: number };

/** Sliders — the "filters" glyph on the overflow chip. Three horizontal tracks,
 *  each with a knob at a different position. */
export function FiltersIcon({ color }: IconProps) {
  // Knob horizontal position per track (fraction of the track width).
  const knobs = [0.7, 0.35, 0.8];
  return (
    <View style={styles.sliders}>
      {knobs.map((pos, i) => (
        <View key={i} style={styles.sliderRow}>
          <View style={[styles.sliderTrack, { backgroundColor: color }]} />
          <View style={[styles.sliderKnob, { backgroundColor: color, left: `${pos * 100}%` }]} />
        </View>
      ))}
    </View>
  );
}

/** Checkmark — the "show results" confirm glyph. A box with right + bottom
 *  borders rotated 45° reads as a tick. */
export function CheckIcon({ color, size = 22 }: IconProps) {
  const stroke = Math.max(2, Math.round(size * 0.11));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.32,
          height: size * 0.6,
          marginTop: -size * 0.08,
          borderRightWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

/** Stacked up/down triangles — the sort glyph. */
export function SortIcon({ color }: IconProps) {
  return (
    <View style={styles.sort}>
      <View style={[styles.triUp, { borderBottomColor: color }]} />
      <View style={[styles.triDown, { borderTopColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  sliders: {
    width: 16,
    gap: 3,
  },
  sliderRow: {
    height: 7,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 2,
    width: '100%',
    borderRadius: 1,
  },
  sliderKnob: {
    position: 'absolute',
    width: 3,
    height: 7,
    marginLeft: -1.5,
    borderRadius: 1,
  },
  sort: {
    alignItems: 'center',
    gap: 3,
  },
  triUp: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  triDown: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
