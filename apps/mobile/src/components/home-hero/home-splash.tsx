import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { PAGE_DOTS_HEIGHT, PageDots } from '@/components/home-bookshelf/page-dots';
import { useShelfOpening } from '@/components/home-bookshelf/opening';
import { Spacing } from '@/constants/theme';
import type { BookshelfEntry } from '@/hooks/use-home-bookshelf';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';
import { useWindowSize } from '@/hooks/use-window-size';
import { heroIsWide, splashArtHeight, splashLayerOpacity } from '@/lib/home-hero';
import { useRouter } from '@/lib/nav';

import { HeroArrows, HeroCaption, HeroFades, heroInset, useHeroStage } from './hero-parts';
import { PosterStage, wideHomeHeroHeight } from './home-poster';
import { useHeroPager } from './use-hero-pager';

const UNDER_DOTS = Spacing.two;

/**
 * The splash's height in a feed `width` wide, known ahead of it as the shelf's is. `top` is where
 * the feed's content starts and `bleed` how far above that the cover begins.
 */
export function homeSplashHeight({ width, windowHeight, top, bleed }: { width: number; windowHeight: number; top: number; bleed: number }): number {
  if (heroIsWide(width)) return wideHomeHeroHeight(windowHeight);
  return splashArtHeight({ width, windowHeight, top, bleed }) + PAGE_DOTS_HEIGHT + UNDER_DOTS;
}

type SplashProps = {
  entries: readonly BookshelfEntry[];
  width: number;
  /** Where the feed's content starts, down the window. */
  top: number;
  /** How far above that the cover begins, and whether that is under a bar with nothing of its own
   *  behind it. */
  bleed: number;
  bare: boolean;
};

function SplashCover({ entry, index, position }: { entry: BookshelfEntry; index: number; position: SharedValue<number> }) {
  const theme = useTheme();
  const uri = useResolvedAsset(entry.thumbnailUrl);
  const style = useAnimatedStyle(() => ({ opacity: splashLayerOpacity(index, position.get()) }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement }, style]}>
      {uri !== undefined && (
        // From its top: a cover's lettering and faces are up there, and its foot is under the words.
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" cachePolicy="memory-disk" transition={150} />
      )}
    </Animated.View>
  );
}

function PhoneSplash({ entries, width, top, bleed, bare }: SplashProps) {
  const router = useRouter();
  const openingOf = useShelfOpening();
  const stage = useHeroStage(width);
  const { height: windowHeight } = useWindowSize();
  const art = splashArtHeight({ width, windowHeight, top, bleed });
  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const pager = useHeroPager({ keys, opens: 0, pitch: stage.width * 0.8, reach: 1 });
  const shown = entries[pager.index];
  if (!shown) return null;

  const opening = openingOf(shown);
  const push = (params: Record<string, string>) => router.push({ pathname: '/series', params });
  const details = () => push(opening.details.params);
  const inset = heroInset(stage);

  return (
    <View style={{ height: art + PAGE_DOTS_HEIGHT + UNDER_DOTS }} testID="home-splash">
      <GestureDetector gesture={pager.pan}>
        <View style={{ width: stage.width, height: art, marginLeft: -stage.lead }}>
          <View pointerEvents="none" style={[styles.art, { top: -bleed }]}>
            {entries.map((entry, index) =>
              Math.abs(index - pager.index) <= 1 ? <SplashCover key={entry.key} entry={entry} index={index} position={pager.position} /> : null,
            )}
            <HeroFades under={bare ? bleed : 0} foot={Math.min(art + bleed, 360)} />
          </View>
          <Pressable
            testID="home-splash.cover"
            style={StyleSheet.absoluteFill}
            onPressIn={opening.details.warm}
            onPress={() => pager.tapped() && details()}
            accessibilityRole="adjustable"
            accessibilityLabel={`${shown.title}, details`}
            accessibilityValue={{ text: `${pager.index + 1} of ${entries.length}` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
            onAccessibilityAction={({ nativeEvent }) => {
              if (nativeEvent.actionName === 'increment') pager.goTo(pager.index + 1);
              else if (nativeEvent.actionName === 'decrement') pager.goTo(pager.index - 1);
              else details();
            }}
          />
          <HeroCaption
            entry={shown}
            opening={opening}
            size="splash"
            onRead={() => push((opening.read ?? opening.details).params)}
            onDetails={details}
            testID="home-splash"
            style={[styles.caption, { left: inset.left, right: inset.right }]}
          />
          <HeroArrows pager={pager} count={entries.length} lead={stage.lead} trail={stage.trail} testID="home-splash" />
        </View>
      </GestureDetector>
      <PageDots count={entries.length} page={pager.index} onPage={pager.goTo} />
    </View>
  );
}

/**
 * Comical Home's splash: the series read last as its cover across the top of the page, running up
 * under the bar where the bar is bare and fading into the page, with where it was left and Resume
 * over its foot. A drag goes to the next series, in order of how much each matters. A trial beside
 * the shelf (Settings → Developer). A window too wide for a cover to cross takes the cover as a
 * book beside the words instead, over its own colours.
 */
export function HomeSplash(props: SplashProps) {
  const { entries, width, bleed, bare } = props;
  if (heroIsWide(width)) return <PosterStage entries={entries} width={width} bleed={bleed} bare={bare} row={false} opens={0} testID="home-splash" />;
  return <PhoneSplash {...props} />;
}

const styles = StyleSheet.create({
  art: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  caption: { position: 'absolute', bottom: Spacing.three },
});
