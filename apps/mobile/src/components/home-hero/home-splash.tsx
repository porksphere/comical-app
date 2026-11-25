import { Image } from 'expo-image';
import { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { PAGE_DOTS_HEIGHT, PageDots } from '@/components/home-bookshelf/page-dots';
import { ZoomSource } from '@/components/zoom-source';
import { Spacing } from '@/constants/theme';
import type { BookshelfEntry } from '@/hooks/use-home-bookshelf';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';
import { useWindowSize } from '@/hooks/use-window-size';
import { heroIsWide, splashArtHeight, splashLayerOpacity } from '@/lib/home-hero';

import { HeroArrows, HeroCaption, HeroFades, heroInset, useHeroStage } from './hero-parts';
import { PosterStage, wideHomeHeroHeight } from './home-poster';
import { useHeroOpen } from './use-hero-open';
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
  /** How far above that the cover begins, under the bar. */
  bleed: number;
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

function PhoneSplash({ entries, width, top, bleed }: SplashProps) {
  const stage = useHeroStage(width);
  const { height: windowHeight } = useWindowSize();
  const art = splashArtHeight({ width, windowHeight, top, bleed });
  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const pager = useHeroPager({ keys, opens: 0, pitch: stage.width * 0.8, reach: 1 });
  const shown = entries[pager.index];
  const artRef = useRef<ViewInstance>(null);
  const open = useHeroOpen(shown, artRef, 0);
  if (!shown || !open) return null;

  const { opening, details } = open;
  const inset = heroInset(stage);

  return (
    <View style={{ height: art + PAGE_DOTS_HEIGHT + UNDER_DOTS }} testID="home-splash">
      <GestureDetector gesture={pager.pan}>
        <View style={{ width: stage.width, height: art, marginLeft: -stage.lead }}>
          {open.zoomHref && (
            <View pointerEvents="none" style={[styles.zoomAt, { top: -bleed }]}>
              <ZoomSource href={open.zoomHref} onId={open.onZoomId} style={{ width: stage.width, height: art + bleed }} />
            </View>
          )}
          {/* All of it goes while the page's copy of the cover is in the air: under the front cover
              lies the one before it, whole. */}
          <View ref={artRef} collapsable={false} pointerEvents="none" style={[styles.art, { top: -bleed }, open.flying && styles.unseen]}>
            {entries.map((entry, index) =>
              Math.abs(index - pager.index) <= 1 ? <SplashCover key={entry.key} entry={entry} index={index} position={pager.position} /> : null,
            )}
            <HeroFades under={bleed} foot={Math.min(art + bleed, 360)} />
          </View>
          <Pressable
            testID="home-splash.cover"
            style={StyleSheet.absoluteFill}
            onPressIn={() => open.pressIn('details')}
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
            onPressIn={open.pressIn}
            onRead={open.read}
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
 * under the bar, which is bare over it, and fading into the page, with where it was left and Resume
 * over its foot. A drag goes to the next series, in order of how much each matters. A trial beside
 * the shelf (Settings → Developer). A window too wide for a cover to cross takes the cover as a
 * book beside the words instead, over its own colours.
 */
export function HomeSplash(props: SplashProps) {
  const { entries, width, bleed } = props;
  if (heroIsWide(width)) return <PosterStage entries={entries} width={width} bleed={bleed} row={false} opens={0} testID="home-splash" />;
  return <PhoneSplash {...props} />;
}

const styles = StyleSheet.create({
  art: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  zoomAt: { position: 'absolute', left: 0 },
  unseen: { opacity: 0 },
  caption: { position: 'absolute', bottom: Spacing.three },
});
