import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { ShelfOpening } from '@/components/home-bookshelf/opening';
import { AboutIcon, ChevronLeftIcon, ChevronRightIcon, ReadingIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing, TopLevelGutter } from '@/constants/theme';
import { useCenterInset, useSideInsets } from '@/hooks/use-content-width';
import type { BookshelfEntry } from '@/hooks/use-home-bookshelf';
import { usePointerFine } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { historyProgress } from '@/lib/history-sub';
import { useScrollbarGutter } from '@/lib/scrollbar-gutter';
import { useTitleFontFor } from '@/lib/title-font';

import type { HeroPager } from './use-hero-pager';

/** A hero's stage: as the shelf's, it runs edge to edge of the pane, under the safe area's sides and
 *  the web's centring margins, while what is read on it stands in the feed's column. */
export function useHeroStage(width: number): { width: number; lead: number; trail: number } {
  const sides = useSideInsets();
  const centre = useCenterInset(sides);
  const gutter = useScrollbarGutter();
  return useMemo(
    () => ({ width: width + sides.left + sides.right - gutter, lead: sides.left + centre, trail: sides.right + centre }),
    [width, sides.left, sides.right, centre, gutter],
  );
}

const BUTTON = 48;

type CaptionSize = 'splash' | 'poster' | 'wide';

/** A poster's words under its book, from the title's top to the button's foot: given, so the
 *  hero's height is known before any of it is laid out. */
export const POSTER_CAPTION_HEIGHT = 16 + 6 + 30 + 4 + 20 + 8 + 3 + 14 + BUTTON;

/**
 * What a hero says of the series in front and the buttons that open it: whether it is being read or
 * has chapters waiting, its title, where reading it goes, how far through that chapter it was left,
 * and Resume (or Read) beside its details.
 */
export function HeroCaption({
  entry,
  opening,
  size,
  onRead,
  onDetails,
  testID,
  style,
}: {
  entry: BookshelfEntry;
  opening: ShelfOpening;
  size: CaptionSize;
  onRead: () => void;
  onDetails: () => void;
  /** The hero's own id: its buttons are `<testID>.resume` and `<testID>.details`. */
  testID: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const titleFont = useTitleFontFor(entry.title);
  const centred = size === 'poster';
  const progress = entry.history ? historyProgress(entry.history) : undefined;
  const verb = opening.resumes ? 'Resume' : 'Read';
  return (
    <View style={[centred && styles.centred, style]}>
      <View style={styles.eyebrow}>
        {entry.unread > 0 && (
          <View style={[styles.badge, { backgroundColor: theme.badgeNew }]}>
            <ThemedText style={[styles.badgeText, { color: theme.badgeNewOn }]}>{entry.unread > 99 ? '99+' : entry.unread} NEW</ThemedText>
          </View>
        )}
        <ThemedText themeColor="textSecondary" style={styles.eyebrowText}>
          {opening.resumes ? 'CONTINUE READING' : 'NEW CHAPTERS'}
        </ThemedText>
      </View>
      <ThemedText
        numberOfLines={centred ? 1 : 2}
        style={[TITLE[size], centred && styles.centredText, titleFont ? { fontFamily: titleFont } : undefined]}>
        {entry.title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={[styles.meta, centred && styles.centredText]}>
        {[opening.bridgeName, opening.detail].filter(Boolean).join(' · ')}
      </ThemedText>
      <View style={[styles.track, centred && styles.centredTrack, progress !== undefined && { backgroundColor: theme.hairline }]}>
        {progress !== undefined && <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.text }]} />}
      </View>
      <View style={styles.buttons}>
        <Pressable
          testID={`${testID}.resume`}
          accessibilityRole="button"
          accessibilityLabel={`${verb} ${entry.title}`}
          onPressIn={() => (opening.read ?? opening.details).warm()}
          onPress={onRead}
          style={({ pressed }) => [styles.read, size === 'splash' && styles.grow, { backgroundColor: theme.text }, pressed && styles.pressed]}>
          <ReadingIcon color={theme.background} size={19} />
          <ThemedText style={[styles.readLabel, { color: theme.background }]}>{verb}</ThemedText>
        </Pressable>
        <Pressable
          testID={`${testID}.details`}
          accessibilityRole="button"
          accessibilityLabel={`${entry.title}, details`}
          onPressIn={opening.details.warm}
          onPress={onDetails}
          style={({ pressed }) => [styles.details, { backgroundColor: theme.backgroundSelected }, pressed && styles.pressed]}>
          <AboutIcon color={theme.text} size={21} />
        </Pressable>
      </View>
    </View>
  );
}

/** A hero's picture going into the page under it, and coming out from under the bar, which is bare
 *  over it (`under`, the bar's reach): the page's own colour either way, which is what the bar's
 *  title and selectors are set to be read on. */
export function HeroFades({ under, foot }: { under: number; foot: number }) {
  const { background } = useTheme();
  return (
    <>
      {under > 0 && (
        <LinearGradient
          pointerEvents="none"
          style={[styles.fadeTop, { height: under + Spacing.five }]}
          colors={[`${background}D9`, `${background}80`, `${background}00`]}
          locations={[0, 0.55, 1]}
        />
      )}
      <LinearGradient
        pointerEvents="none"
        style={[styles.fadeFoot, { height: foot }]}
        colors={[`${background}00`, `${background}8C`, `${background}E6`, background]}
        locations={[0, 0.4, 0.7, 1]}
      />
    </>
  );
}

/** The next and the previous series, for a mouse: a finger drags the hero, and a wheel scrolls the
 *  feed under it. */
export function HeroArrows({ pager, count, lead, trail, testID }: { pager: HeroPager; count: number; lead: number; trail: number; testID: string }) {
  const theme = useTheme();
  const fine = usePointerFine();
  if (!fine || count < 2) return null;
  const arrow = (to: number, side: ViewStyle, id: string, label: string, Icon: typeof ChevronLeftIcon) =>
    to < 0 || to >= count ? null : (
      <Pressable
        testID={`${testID}.${id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => pager.goTo(to)}
        style={({ pressed }) => [styles.arrow, side, { backgroundColor: theme.backgroundSelected }, pressed && styles.pressed]}>
        <Icon color={theme.text} size={20} strokeWidth={2.4} />
      </Pressable>
    );
  return (
    <>
      {arrow(pager.index - 1, { left: lead + Spacing.two }, 'previous', 'Previous series', ChevronLeftIcon)}
      {arrow(pager.index + 1, { right: trail + Spacing.two }, 'next', 'Next series', ChevronRightIcon)}
    </>
  );
}

/** How far a hero's words stand in from the stage's edges: the feed's column, and its gutter. */
export const heroInset = (stage: { lead: number; trail: number }) => ({ left: stage.lead + TopLevelGutter, right: stage.trail + TopLevelGutter });

const TITLE = StyleSheet.create({
  splash: { fontSize: 28, lineHeight: 34 },
  poster: { fontSize: 24, lineHeight: 30 },
  wide: { fontSize: 40, lineHeight: 48 },
});

const styles = StyleSheet.create({
  centred: { alignItems: 'center' },
  centredText: { textAlign: 'center' },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, height: 16, marginBottom: 6 },
  eyebrowText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 1 },
  badge: { paddingHorizontal: 6, borderRadius: 5, height: 16, justifyContent: 'center' },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: '900', letterSpacing: 0.4 },
  meta: { marginTop: 4 },
  track: { height: 3, borderRadius: 1.5, marginTop: Spacing.two, alignSelf: 'stretch', overflow: 'hidden' },
  centredTrack: { alignSelf: 'center', width: 200 },
  fill: { height: '100%', borderRadius: 1.5 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  read: {
    height: BUTTON,
    borderRadius: BUTTON / 2,
    paddingHorizontal: Spacing.four + Spacing.one,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  grow: { flex: 1 },
  readLabel: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  details: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72 },
  fadeTop: { position: 'absolute', left: 0, right: 0, top: 0 },
  fadeFoot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  arrow: {
    position: 'absolute',
    top: '38%',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : {}),
  },
});
