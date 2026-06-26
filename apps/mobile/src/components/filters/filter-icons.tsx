import { StyleSheet, View } from 'react-native';

// Native icons for the filter bar. The web build uses lucide via the `.web.tsx`
// sibling (lucide-react is web-only); these hand-built glyphs are the RN
// fallback. Keep the two files' exports in sync.

export type IconProps = { color: string; size?: number };

/** Funnel — the "filters" glyph on the overflow chip. */
export function FiltersIcon({ color }: IconProps) {
  return (
    <View style={styles.funnel}>
      <View style={[styles.funnelBar, { width: 14, backgroundColor: color }]} />
      <View style={[styles.funnelBar, { width: 9, backgroundColor: color }]} />
      <View style={[styles.funnelBar, { width: 4, backgroundColor: color }]} />
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
  funnel: {
    alignItems: 'center',
    gap: 3,
  },
  funnelBar: {
    height: 2,
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
