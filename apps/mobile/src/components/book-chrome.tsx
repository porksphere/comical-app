import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ContinuousCorner, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { FOLD, HINGE, PANE, SHADOW, SHADOW_DEPTH, SHEET_OFFSET, bookRadius, ribbonSize, type BookCover } from '@/lib/book-cover';

const FROM_SPINE = {
  left: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  right: { start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
} as const;
const DOWN = { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } } as const;

/** The book drawn over a cover's picture, inside its clip: the spine-side shading for its form, then
 *  the rim and top-edge light. Never takes a touch. The rim's corner is the clip's own shape, not just
 *  its radius: a circular arc inside a continuous corner draws a second edge across the picture. */
export function BookChrome({ cover }: { cover: BookCover }) {
  const theme = useTheme();
  const radius = bookRadius(cover, useIsDesktop());
  return (
    <>
      {cover.form === 'scroll' || cover.form === 'sheets' ? (
        <LinearGradient style={styles.fill} colors={PANE.colors} locations={PANE.locations} {...DOWN} />
      ) : (
        <LinearGradient
          style={styles.fill}
          colors={cover.form === 'volume' ? HINGE.colors : FOLD.colors}
          locations={cover.form === 'volume' ? HINGE.locations : FOLD.locations}
          {...FROM_SPINE[cover.binding]}
        />
      )}
      <View style={[styles.fill, styles.rim, ContinuousCorner, { borderRadius: radius, borderColor: theme.coverRim }]} />
    </>
  );
}

/** The shadow under a cover — see `SHADOW`. Lives in the card's trailing group, which starts one gap
 *  below the cover and moves with it while the cover's aspect settles. It spans only the cover's flat
 *  bottom edge, since a straight strip under a rounded corner shows as a bar poking out past it; under
 *  a CG set it also stops where the front sheet does. */
export function CoverShadow({ cover }: { cover: BookCover }) {
  const inset = bookRadius(cover, useIsDesktop());
  return (
    <LinearGradient
      style={[styles.shadow, { left: inset, right: inset }, cover.form === 'sheets' && styles.shadowUnderFrontSheet]}
      colors={SHADOW.colors}
      locations={SHADOW.locations}
      {...DOWN}
    />
  );
}

/** The sheet behind a CG set's front picture: the same size, offset up and to the right, so it shows
 *  along the top and the far edge. Drawn under the front sheet, outside its clip. */
export function LooseSheet({ radius }: { radius: number }) {
  const theme = useTheme();
  return <View style={[styles.sheetBehind, ContinuousCorner, { borderRadius: radius, backgroundColor: theme.coverSheet, borderColor: theme.coverRim }]} />;
}

/** "In your library", as the bookmark it already was in icon form, hanging from the head of the
 *  spine. A shape bridges can't send, so nothing a bridge sends can imitate it. Two plain views — the
 *  notched tail is a border triangle — rather than an SVG per saved card. */
export function LibraryRibbon({ style }: { style: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const { width, height } = ribbonSize(useIsDesktop());
  const notch = Math.round(height * 0.22);
  return (
    <View accessibilityLabel="In your library" style={[styles.ribbon, { width, height }, style]}>
      <View style={{ height: height - notch, backgroundColor: theme.accent }} />
      <View
        style={[
          styles.tail,
          { borderLeftWidth: width / 2, borderRightWidth: width / 2, borderBottomWidth: notch, borderLeftColor: theme.accent, borderRightColor: theme.accent },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
  },
  rim: {
    borderWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.28)',
  },
  shadow: {
    position: 'absolute',
    top: -Spacing.two,
    height: SHADOW_DEPTH,
    pointerEvents: 'none',
  },
  shadowUnderFrontSheet: {
    right: `${SHEET_OFFSET.right * 100}%`,
  },
  sheetBehind: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: `${SHEET_OFFSET.top * 100}%`,
    left: `${SHEET_OFFSET.right * 100}%`,
    borderWidth: StyleSheet.hairlineWidth,
    pointerEvents: 'none',
  },
  ribbon: {
    position: 'absolute',
    top: 0,
    zIndex: 2,
    pointerEvents: 'none',
  },
  tail: {
    width: 0,
    height: 0,
    borderBottomColor: 'transparent',
  },
});
