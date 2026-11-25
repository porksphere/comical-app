import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { BookCoverArt } from '@/components/book-chrome';
import { PAGE_DOTS_HEIGHT, PageDots } from '@/components/home-bookshelf/page-dots';
import { useShelfOpening } from '@/components/home-bookshelf/opening';
import { Spacing } from '@/constants/theme';
import { useBookCover } from '@/hooks/use-book-covers';
import { useBridgeMap } from '@/hooks/use-bridges';
import type { BookshelfEntry } from '@/hooks/use-home-bookshelf';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { useWindowSize } from '@/hooks/use-window-size';
import { shelfMiddle } from '@/lib/bookshelf';
import {
  HERO_COVER_ASPECT,
  WIDE_BOOK_MARGIN,
  fitCover,
  heroIsWide,
  lonePlace,
  posterBookBox,
  posterPlace,
  posterReach,
  splashLayerOpacity,
  wideHeroHeight,
} from '@/lib/home-hero';
import { useRouter } from '@/lib/nav';
import { testId } from '@/lib/test-id';

import { HeroArrows, HeroCaption, HeroFades, POSTER_CAPTION_HEIGHT, heroInset, useHeroStage } from './hero-parts';
import { useHeroPager } from './use-hero-pager';

/** Room over a phone's book, and between it and its words. */
const HEAD = Spacing.three;
const UNDER_BOOK = 18;
const UNDER_DOTS = Spacing.two;

/** The stage of a poster on a phone: its book, its words and the room round them. */
const phoneStageHeight = (width: number) => HEAD + posterBookBox(width).height + UNDER_BOOK + POSTER_CAPTION_HEIGHT + Spacing.two;

/** A wide hero's height in a window this tall, dots and all: the poster's, and the splash's where
 *  the window is too wide for a cover to cross it. */
export const wideHomeHeroHeight = (windowHeight: number) => wideHeroHeight(windowHeight) + PAGE_DOTS_HEIGHT + UNDER_DOTS;

/** The poster's height in a feed `width` wide, known ahead of it as the shelf's is. */
export function homePosterHeight(width: number, windowHeight: number): number {
  return heroIsWide(width) ? wideHomeHeroHeight(windowHeight) : phoneStageHeight(width) + PAGE_DOTS_HEIGHT + UNDER_DOTS;
}

/** How far the blurred cover runs past the stage, so the blur's soft edge is never on it. */
const GLOW_SPILL = 60;
const GLOW_BLUR = 44;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The front series' cover out of focus, as the stage's colour. */
function PosterGlow({ entry, index, position }: { entry: BookshelfEntry; index: number; position: SharedValue<number> }) {
  const theme = useTheme();
  const uri = useResolvedAsset(entry.thumbnailUrl);
  const style = useAnimatedStyle(() => ({ opacity: splashLayerOpacity(index, position.get()) }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, style]}>
      {uri !== undefined && <Image source={{ uri }} style={styles.glow} contentFit="cover" blurRadius={GLOW_BLUR} cachePolicy="memory-disk" />}
    </Animated.View>
  );
}

function PosterBook({
  entry,
  index,
  position,
  direct,
  wide,
  row,
  box,
  left,
  top,
  front,
  passed,
  count,
  testID,
  onPressIn,
  onPress,
  onStep,
}: {
  entry: BookshelfEntry;
  index: number;
  position: SharedValue<number>;
  direct: boolean;
  wide: boolean;
  /** Whether it stands in a row of the others, or alone. */
  row: boolean;
  box: { width: number; height: number };
  left: number;
  top: number;
  front: boolean;
  /** Before the front one in a wide hero, where it is not drawn and lies over the words. */
  passed: boolean;
  count: number;
  testID: string;
  onPressIn: () => void;
  onPress: () => void;
  onStep: (by: number) => void;
}) {
  const uri = useResolvedAsset(entry.thumbnailUrl);
  const [aspect, setAspect] = useState<number>(HERO_COVER_ASPECT);
  const book = useBookCover({
    bridgeId: entry.bridgeId,
    seriesId: entry.seriesId,
    direct,
    aspect,
    coverForm: entry.coverForm,
    readingDirection: entry.readingDirection,
  });
  const { width, height } = box;
  const style = useAnimatedStyle(() => {
    const away = index - position.get();
    const place = row ? posterPlace(away, wide) : lonePlace(away);
    return {
      opacity: place.opacity,
      // Scaled about its foot, so the row stands on one line.
      transform: [{ translateX: place.x * width }, { translateY: ((1 - place.scale) * height) / 2 }, { scale: place.scale }],
    };
  });
  const fitted = fitCover(aspect, box);
  const picture =
    uri === undefined ? null : (
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        onLoad={({ source }) => {
          if (source.width > 0 && source.height > 0) setAspect(clamp(source.width / source.height, 0.5, 1.6));
        }}
      />
    );
  return (
    <Animated.View
      pointerEvents={passed ? 'none' : 'box-none'}
      style={[styles.book, { left, top, width, height, zIndex: front ? 1 : 0 }, style]}>
      <Pressable
        testID={testID}
        onPressIn={onPressIn}
        onPress={onPress}
        style={fitted}
        {...(front
          ? {
              accessibilityRole: 'adjustable' as const,
              accessibilityLabel: `${entry.title}, details`,
              accessibilityValue: { text: `${index + 1} of ${count}` },
              accessibilityActions: [{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }],
              onAccessibilityAction: ({ nativeEvent }: { nativeEvent: { actionName: string } }) => {
                if (nativeEvent.actionName === 'increment') onStep(1);
                else if (nativeEvent.actionName === 'decrement') onStep(-1);
                else onPress();
              },
            }
          : { accessibilityRole: 'button' as const, accessibilityLabel: entry.title })}>
        <BookCoverArt book={book} aspect={aspect} cover={uri} recyclingKey={entry.key} picture={picture} />
      </Pressable>
    </Animated.View>
  );
}

/**
 * A hero that shows the series in front as its cover whole, as the book it is, over that cover's
 * own colours out of focus. On a phone the book stands in the middle with its words under it. In a
 * wide window the words stand beside it. With a `row` the others stand to either side, smaller
 * and fainter, and a drag runs along them; without one the book stands alone and each gives way to
 * the next. `bleed` is how far the colours run up past the feed's content, under the bar.
 */
export function PosterStage({
  entries,
  width,
  bleed,
  row,
  opens,
  testID,
}: {
  entries: readonly BookshelfEntry[];
  width: number;
  bleed: number;
  row: boolean;
  /** Where the hero opens among `entries`. */
  opens: number;
  testID: string;
}) {
  const theme = useTheme();
  const dark = useActiveColorScheme() === 'dark';
  const router = useRouter();
  const { directOf } = useBridgeMap();
  const openingOf = useShelfOpening();
  const stage = useHeroStage(width);
  const { height: windowHeight } = useWindowSize();
  const wide = heroIsWide(width);
  const stageHeight = wide ? wideHeroHeight(windowHeight) : phoneStageHeight(width);
  const box = posterBookBox(width, wide ? stageHeight : undefined);
  const inset = heroInset(stage);
  const column = stage.width - inset.left - inset.right;
  const captionWidth = Math.min(row ? 440 : 520, column * (row ? 0.42 : 0.5));
  // The front book's middle: the column's on a phone, beside the words in a wide hero with a row
  // running on from it, and toward the far edge where it stands alone.
  const frontX = !wide
    ? inset.left + column / 2
    : row
      ? inset.left + captionWidth + Spacing.five + box.width / 2
      : stage.width - inset.right - Spacing.six - box.width / 2;
  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const pager = useHeroPager({ keys, opens, pitch: box.width * (wide ? 0.96 : 0.86), reach: row ? 3 : 1 });
  const shown = entries[pager.index];
  if (!shown) return null;

  const opening = openingOf(shown);
  const push = (params: Record<string, string>) => router.push({ pathname: '/series', params });
  const read = () => push((opening.read ?? opening.details).params);
  const details = () => push(opening.details.params);
  const reach = row ? posterReach(wide) : 1;
  const press = (index: number) => {
    if (!pager.tapped()) return;
    if (index === pager.index) details();
    else pager.goTo(index);
  };

  return (
    <View style={{ height: stageHeight + PAGE_DOTS_HEIGHT + UNDER_DOTS }} testID={testID}>
      <GestureDetector gesture={pager.pan}>
        <View style={{ width: stage.width, height: stageHeight, marginLeft: -stage.lead }}>
          <View pointerEvents="none" style={[styles.backdrop, { top: -bleed }]}>
            {entries.map((entry, index) =>
              Math.abs(index - pager.index) <= 1 ? <PosterGlow key={entry.key} entry={entry} index={index} position={pager.position} /> : null,
            )}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: dark ? 0.35 : 0.5 }]} />
            <HeroFades under={bleed} foot={Math.round(stageHeight * 0.55)} />
          </View>
          {entries.map((entry, index) =>
            Math.abs(index - pager.index) <= reach ? (
              <PosterBook
                key={entry.key}
                entry={entry}
                index={index}
                position={pager.position}
                direct={directOf(entry.bridgeId)}
                wide={wide}
                row={row}
                box={box}
                left={frontX - box.width / 2}
                top={wide ? WIDE_BOOK_MARGIN : HEAD}
                front={index === pager.index}
                passed={index !== pager.index && (!row || (wide && index < pager.index))}
                count={entries.length}
                testID={testId(`${testID}.book`, entry.key)}
                onPressIn={index === pager.index ? opening.details.warm : noop}
                onPress={() => press(index)}
                onStep={(by) => pager.goTo(pager.index + by)}
              />
            ) : null,
          )}
          <HeroCaption
            entry={shown}
            opening={opening}
            size={wide ? 'wide' : 'poster'}
            onRead={read}
            onDetails={details}
            testID={testID}
            style={
              wide
                ? [styles.caption, { left: inset.left, width: captionWidth, bottom: WIDE_BOOK_MARGIN }]
                : [styles.caption, { left: inset.left, right: inset.right, top: HEAD + box.height + UNDER_BOOK }]
            }
          />
          <HeroArrows pager={pager} count={entries.length} lead={stage.lead} trail={stage.trail} testID={testID} />
        </View>
      </GestureDetector>
      <PageDots count={entries.length} page={pager.index} onPage={pager.goTo} />
    </View>
  );
}

const noop = () => {};

/**
 * Comical Home's poster: what you are reading as a row of covers, the one in the middle whole and
 * the others smaller to either side, over the front one's own colours. A trial beside the shelf
 * (Settings → Developer), of the shelf's own books stood as the shelf stands them.
 */
export function HomePoster({ entries, width, bleed }: { entries: readonly BookshelfEntry[]; width: number; bleed: number }) {
  return <PosterStage entries={entries} width={width} bleed={bleed} row opens={shelfMiddle(entries.length)} testID="home-poster" />;
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  glow: { position: 'absolute', left: -GLOW_SPILL, right: -GLOW_SPILL, top: -GLOW_SPILL, bottom: -GLOW_SPILL },
  book: { position: 'absolute', alignItems: 'center', justifyContent: 'flex-end' },
  caption: { position: 'absolute' },
});
