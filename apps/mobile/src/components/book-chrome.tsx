import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { FOLD, GLOSS, HINGE, PANE, SHADOW, SHADOW_DEPTH, bookRadius, ribbonSize, type BookCover } from '@/lib/book-cover';

const FROM_SPINE = {
  left: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  right: { start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
} as const;
const DOWN = { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } } as const;
const ACROSS_THE_GRAIN = { start: { x: 0, y: 0.25 }, end: { x: 1, y: 0.75 } } as const;

/** The book drawn over a cover's picture, inside its clip: the spine-side shading for its form, then
 *  the rim and top-edge light. Never takes a touch. */
export function BookChrome({ cover }: { cover: BookCover }) {
  const theme = useTheme();
  const radius = bookRadius(cover, useIsDesktop());
  return (
    <>
      {cover.form === 'scroll' ? (
        <LinearGradient style={styles.fill} colors={PANE.colors} locations={PANE.locations} {...DOWN} />
      ) : (
        <LinearGradient
          style={styles.fill}
          colors={cover.form === 'volume' ? HINGE.colors : FOLD.colors}
          locations={cover.form === 'volume' ? HINGE.locations : FOLD.locations}
          {...FROM_SPINE[cover.binding]}
        />
      )}
      {cover.form === 'issue' && <LinearGradient style={styles.fill} colors={GLOSS.colors} locations={GLOSS.locations} {...ACROSS_THE_GRAIN} />}
      <View style={[styles.fill, styles.rim, { borderRadius: radius, borderColor: theme.coverRim }]} />
    </>
  );
}

/** The shadow under a cover — see `SHADOW`. Lives in the card's trailing group, which starts one gap
 *  below the cover and moves with it while the cover's aspect settles. */
export function CoverShadow() {
  return <LinearGradient style={styles.shadow} colors={SHADOW.colors} locations={SHADOW.locations} {...DOWN} />;
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

/** A hidden series, wrapped in plain paper the way a bookshop wraps a book nobody should see you
 *  reading: the object stays on the shelf, its cover doesn't. Drawn under `BookChrome`. */
export function PaperWrap() {
  const theme = useTheme();
  return (
    <View style={[styles.fill, styles.wrap, { backgroundColor: theme.paperWrap }]}>
      <View style={[styles.label, { borderColor: theme.paperWrapInk }]}>
        <ThemedText style={[styles.labelText, { color: theme.paperWrapInk }]}>Hidden</ThemedText>
      </View>
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
    left: 1,
    right: 1,
    height: SHADOW_DEPTH,
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
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  labelText: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
