import { Image as Picture } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Fragment, type ReactNode } from 'react';
import { Image, Platform, StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { ContinuousCorner } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { useCoverGlow } from '@/hooks/use-cover-glow';
import {
  BOOK_COVERS,
  EDGES,
  FOLD,
  LIFT_SHADE,
  NEUTRAL_LIFT_GLOW,
  PRINT,
  SPINE,
  STAPLE,
  STAPLES,
  bookRadius,
  liftShadows,
  printWindow,
  ribbonSize,
  shadowPlacement,
  type BookCover,
} from '@/lib/book-cover';
import { liftGlow } from '@/lib/cover-glow';

const FROM_SPINE = {
  left: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  right: { start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
} as const;
const DOWN = { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } } as const;
const ACROSS = { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } as const;

/** The book drawn over a cover's picture, inside its clip: a bound form's spine or an issue's fold, its
 *  fore-edge, and every form's top and bottom edge. Light and shade only — no outline, which on a page
 *  of the cover's own colour reads as an app tile's border rather than a book's edge. An issue's
 *  staples are `BookStaples`, outside the clip. Never takes a touch. */
export function BookChrome({ cover }: { cover: BookCover }) {
  // A print's edge is its paper (`PrintPaper`); nothing is drawn over its picture.
  if (cover.form === 'sheets') return null;
  const across = cover.form === 'volume' ? SPINE : cover.form === 'issue' ? FOLD : null;
  return (
    <>
      {across && (
        <LinearGradient style={styles.fill} colors={across.colors} locations={across.locations} {...FROM_SPINE[cover.binding]} />
      )}
      <LinearGradient style={styles.fill} colors={EDGES.colors} locations={EDGES.locations} {...DOWN} />
    </>
  );
}

/** An issue's staples. They overhang the binding edge, so they are drawn beside the cover's clip, not
 *  in it, by whatever holds the cover, in a box the cover's size. Each casts a hard shadow, offset as
 *  the light falls, rather than a live one per card. */
export function BookStaples({ cover }: { cover: BookCover }) {
  if (cover.form !== 'issue') return null;
  return (
    <>
      {STAPLES.at.map((at) => {
        const place = { top: `${at * 100}%`, [cover.binding]: `${-STAPLES.overhang * 100}%` } as const;
        return (
          <Fragment key={at}>
            <View style={[styles.staple, styles.stapleShadow, place]} />
            <LinearGradient style={[styles.staple, place]} colors={STAPLE.colors} locations={STAPLE.locations} {...ACROSS} />
          </Fragment>
        );
      })}
    </>
  );
}

const SHADOW = require('@/assets/images/book-shadow-light.png');
const GLOW_RIM = require('@/assets/images/book-glow-rim.png');
const GLOW_FOOT = require('@/assets/images/book-glow-foot.png');
/** The glow before a cover's own tints are read, and for good where they can't be. The web draws it
 *  with opacity rather than a tint: a tint there is an SVG filter per picture (see `CoverGlow`). */
const NEUTRAL_GLOW = Platform.select<{ rim: ImageStyle; foot: ImageStyle }>({
  web: { rim: { opacity: 200 / 255 }, foot: { opacity: 138 / 255 } },
  default: { rim: { tintColor: 'rgb(200,200,200)' }, foot: { tintColor: 'rgb(138,138,138)' } },
});
const percent = (p: { left: number; top: number; width: number; height: number }): ImageStyle => ({
  left: `${p.left * 100}%`,
  top: `${p.top * 100}%`,
  width: `${p.width * 100}%`,
  height: `${p.height * 100}%`,
});
const UNDER_COVER = percent(shadowPlacement(false));
const UNDER_PRINT = percent(shadowPlacement(true));

/** A box the cover's size: over the top of a card, `aspect` its shape, or filling a parent that is
 *  the cover's own size (`fill`) — the series page's hero, whose shape eases as its picture lands. */
const coverBox = (aspect: number, fill: boolean | undefined) => (fill ? styles.fill : [styles.shadowBox, { aspectRatio: aspect }]);

/**
 * The soft shadow under a cover in light mode, and in dark mode the glow Apple Books draws instead —
 * in the cover's own colours (`useCoverGlow`), since a shadow on black is no shadow. Pre-blurred
 * pictures stretched under each card: a live blur is a masked layer per card on iOS and a
 * BlurMaskFilter paint on Android.
 *
 * Placed inside a box the cover's own size, by percentages OF THAT BOX: left and width of its width,
 * top and height of its height, which every platform agrees on. (Offsetting by a percentage margin of
 * the card instead was right on the web and wrong on iOS, whose layout measures a vertical margin
 * against the card's height — title and all — and drew the glow a cover's-worth of margin too high.)
 * Stretched with the cover, so each picture's cover lands exactly on the real one at any shape.
 *
 * The card's first child, so it draws under the cover. On the web a list paint-contains each item to
 * its slot, so the faint side falloff is cut at the grid's outer edges; the foot, which is most of it,
 * sits in the card's own title space.
 */
export function BookShadow({
  aspect,
  fill,
  sheets,
  cover,
}: {
  aspect: number;
  fill?: boolean;
  sheets: boolean;
  cover: string | undefined;
}) {
  const dark = useActiveColorScheme() === 'dark';
  const glow = useCoverGlow(dark ? cover : undefined);
  // A CG set casts it from its front print.
  const picture = sheets ? UNDER_PRINT : UNDER_COVER;
  return (
    <View style={coverBox(aspect, fill)}>
      {!dark ? (
        <Image source={SHADOW} resizeMode="stretch" style={[styles.shadow, picture]} />
      ) : glow?.picture ? (
        <Image source={{ uri: glow.picture }} resizeMode="stretch" style={[styles.shadow, picture]} />
      ) : (
        <>
          <Image source={GLOW_RIM} resizeMode="stretch" style={[styles.shadow, picture, glow ? { tintColor: glow.rim } : NEUTRAL_GLOW.rim]} />
          <Image source={GLOW_FOOT} resizeMode="stretch" style={[styles.shadow, picture, glow ? { tintColor: glow.foot } : NEUTRAL_GLOW.foot]} />
        </>
      )}
    </View>
  );
}

/**
 * A CG set's print: white paper, its picture in a window with a border the same width all round.
 * `children` is the picture. `tipped` turns it to lie behind the front one.
 */
export function PrintPaper({
  aspect,
  tipped,
  windowStyle,
  children,
}: {
  aspect: number;
  tipped?: boolean;
  windowStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  const radius = bookRadius(BOOK_COVERS.sheets.left, useIsDesktop());
  const w = printWindow(aspect);
  return (
    <View
      style={[
        styles.print,
        ContinuousCorner,
        tipped && styles.tipped,
        { borderRadius: radius, backgroundColor: theme.coverPaper, borderColor: theme.coverPaperEdge },
      ]}>
      <View
        style={[
          styles.printWindow,
          { left: `${w.left * 100}%`, right: `${w.right * 100}%`, top: `${w.top * 100}%`, bottom: `${w.bottom * 100}%` },
          windowStyle,
        ]}>
        {children}
      </View>
    </View>
  );
}

/** The print tipped behind a CG set's front one: the set's own picture, dimmed. The card draws it,
 *  under its cover, since the card is what has the picture. */
export function BehindPrint({
  aspect,
  fill,
  cover,
  recyclingKey,
}: {
  aspect: number;
  fill?: boolean;
  cover: string | undefined;
  recyclingKey: string;
}) {
  return (
    <View style={coverBox(aspect, fill)}>
      <PrintPaper aspect={aspect} tipped>
        {cover !== undefined && (
          <Picture source={{ uri: cover }} style={styles.fill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={recyclingKey} />
        )}
        <View style={[styles.fill, styles.dim]} />
      </PrintPaper>
    </View>
  );
}

/**
 * The lift under a list row's thumbnail: the cards' shadow, or in dark mode their glow in the cover's
 * colours, with no book drawn on the thumbnail. Live shadows (`liftShadows`), behind the thumbnail and
 * filling its parent, which is the thumbnail's size, with its corners.
 */
export function ThumbLift({ width, radius, cover }: { width: number; radius: number; cover: string | undefined }) {
  const dark = useActiveColorScheme() === 'dark';
  const glow = useCoverGlow(dark ? cover : undefined);
  const shade = !dark ? LIFT_SHADE : glow ? liftGlow(glow) : NEUTRAL_LIFT_GLOW;
  return <View style={[styles.fill, ContinuousCorner, { borderRadius: radius, boxShadow: liftShadows(width, shade) }]} />;
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
  staple: {
    position: 'absolute',
    width: `${STAPLES.width * 100}%`,
    height: `${STAPLES.length * 100}%`,
    // A pill at any size: every platform clamps a radius to half the shorter side.
    borderRadius: 99,
    pointerEvents: 'none',
  },
  stapleShadow: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    transform: [{ translateX: 0.6 }, { translateY: 0.5 }],
  },
  shadowBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    pointerEvents: 'none',
  },
  shadow: {
    position: 'absolute',
  },
  print: {
    position: 'absolute',
    left: `${PRINT.left * 100}%`,
    top: `${PRINT.top * 100}%`,
    width: `${PRINT.width * 100}%`,
    height: `${PRINT.height * 100}%`,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tipped: {
    transform: [{ rotate: `${PRINT.tilt}deg` }],
  },
  printWindow: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 1,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  dim: {
    backgroundColor: 'rgba(0,0,0,0.3)',
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
