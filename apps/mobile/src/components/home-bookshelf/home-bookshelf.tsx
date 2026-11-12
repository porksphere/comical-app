import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, Pattern, Polygon, Rect } from 'react-native-svg';

import { FeedHeading, SECTION_HEAD_ROW_HEIGHT } from '@/components/content-feed';
import { ThemedText } from '@/components/themed-text';
import { withZoomSource } from '@/components/zoom-source';
import { Spacing, TopLevelGutter } from '@/constants/theme';
import { resolveAssetSourceCached } from '@/data/api';
import { useWarmChapterPages } from '@/data/prefetch';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useBookCoverResolver } from '@/hooks/use-book-covers';
import { useBridgeMap } from '@/hooks/use-bridges';
import { markHomeBookshelfUnavailable, type BookshelfEntry } from '@/hooks/use-home-bookshelf';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import {
  NEUTRAL_BOARD,
  SHELF_ASPECT,
  bookDepth,
  inkOn,
  shelfCallouts,
  shelfCoverWidth,
  shelfStageHeight,
  type Rgb,
  type ShelfCallouts,
} from '@/lib/bookshelf';
import { historySub } from '@/lib/history-sub';
import { useRouter } from '@/lib/nav';
import { historyResumeParams } from '@/lib/series-links';
import { useTitleFontFor } from '@/lib/title-font';

import { ShelfDriver } from './driver';
import type { ShelfBookSpec } from './scene';

// Its own chunk on the web: three and the scene are most of a megabyte that only the shelf needs.
const ShelfCanvas = lazy(() => import('./engine').then((m) => ({ default: m.ShelfCanvas })));

/** The title, where the reader stopped, and Resume, under the stage. */
const CAPTION_HEIGHT = 60;

/** Its height in a feed `width` wide, heading and all — known ahead of it, so the feed's offsets
 *  below never wait on a measurement. */
export function homeBookshelfHeight(width: number): number {
  return SECTION_HEAD_ROW_HEIGHT + shelfStageHeight(width) + CAPTION_HEIGHT + Spacing.two;
}

// A sticker is ink on paper whatever the theme; only the tone it casts follows the page.
const STICKER = { paper: '#ffffff', ink: '#1c1c1e' } as const;
const TONE = { light: '#1c1c1e', dark: '#8a8a8f' } as const;

/** The burst's outline: thirteen uneven points, the same every time. */
const BURST = (() => {
  let seed = 11;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const points: string[] = [];
  for (let k = 0; k < 26; k++) {
    const angle = (k / 26) * Math.PI * 2 + (random() - 0.5) * 0.12;
    const reach = k % 2 ? 28 + random() * 4 : 39 + random() * 7;
    points.push(`${(Math.cos(angle) * reach).toFixed(1)},${(Math.sin(angle) * reach).toFixed(1)}`);
  }
  return points.join(' ');
})();

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A renderer that throws as it starts takes the shelf away, not the screen. */
class Fallible extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The tone a sticker casts: dots, never a blur. */
function ToneShadow({ id, colour }: { id: string; colour: string }) {
  return (
    <Svg style={styles.toneShadow} width="100%" height="100%">
      <Defs>
        <Pattern id={id} patternUnits="userSpaceOnUse" width={4} height={4}>
          <Circle cx={2} cy={2} r={1.1} fill={colour} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

function Burst({ fx, count, tone }: { fx: SharedValue<ShelfCallouts>; count: number; tone: string }) {
  const style = useAnimatedStyle(() => {
    const { burst, pop, settled } = fx.get();
    return {
      opacity: count ? Math.min(1, settled * 4) : 0,
      transform: [{ translateX: burst.x - 48 }, { translateY: burst.y - 48 }, { scale: pop * burst.scale }, { rotate: '-10deg' }],
    };
  });
  return (
    <Animated.View style={[styles.burst, style]}>
      <Svg width={96} height={96} viewBox="-50 -50 100 100">
        <Defs>
          <Pattern id="bookshelf-burst-tone" patternUnits="userSpaceOnUse" width={4} height={4}>
            <Circle cx={2} cy={2} r={1.15} fill={tone} />
          </Pattern>
        </Defs>
        <Polygon points={BURST} fill="url(#bookshelf-burst-tone)" transform="translate(5 6)" />
        <Polygon points={BURST} fill={STICKER.paper} stroke={STICKER.ink} strokeWidth={2.6} strokeLinejoin="miter" />
      </Svg>
      <View style={styles.burstLabel}>
        <Text style={styles.burstCount}>{count}</Text>
        <Text style={styles.burstNew}>NEW!</Text>
      </View>
    </Animated.View>
  );
}

function Caption({ fx, where, tone }: { fx: SharedValue<ShelfCallouts>; where: string; tone: string }) {
  const style = useAnimatedStyle(() => {
    const { caption, pop, settled } = fx.get();
    return {
      opacity: Math.min(1, settled * 4),
      // Hung off the corner by the side it stands on, most of it clear of the cover.
      transform: [
        { translateX: caption.x },
        { translateY: caption.y },
        { translateX: caption.side < 0 ? '-34%' : '-66%' },
        { translateY: '-38%' },
        { scale: pop },
        { rotate: caption.side < 0 ? '-3deg' : '3deg' },
      ],
    };
  });
  return (
    <Animated.View style={[styles.caption, style]}>
      <ToneShadow id="bookshelf-caption-tone" colour={tone} />
      <View style={styles.captionBox}>
        <Text style={styles.captionLabel}>CONTINUE!</Text>
        {where ? (
          <Text style={styles.captionWhere} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

function UnreadTab({ fx, index, count, tone }: { fx: SharedValue<ShelfCallouts>; index: number; count: number; tone: string }) {
  const style = useAnimatedStyle(() => {
    const tab = fx.get().tabs[index];
    if (!tab) return { opacity: 0 };
    return { opacity: tab.shelved, transform: [{ translateX: tab.x - 11 }, { translateY: tab.y - 11 }] };
  });
  return (
    <Animated.View style={[styles.tab, { boxShadow: `2px 2px 0 ${tone}` }, style]}>
      <Text style={styles.tabCount}>{count > 99 ? '99' : count}</Text>
    </Animated.View>
  );
}

/**
 * What Comical Home opens on: what you are reading, as books on a shelf. They stand spine out; the
 * one in the middle comes forward and turns to show its cover, in colour against a shelf drawn in
 * the app's screentone, and wears where you stopped and how many chapters are new. A drag runs
 * along the shelf, a tap on a spine brings that book forward, and a tap on the front book — or
 * Resume — opens it where the History tab would.
 *
 * The books are lit geometry (`ShelfScene`), drawn through one camera that `lib/bookshelf` also
 * projects with, which is how the callouts — plain views over the canvas — stand on a book's
 * corners. Everything that moves is `ShelfDriver`'s.
 */
export function HomeBookshelf({ entries, width }: { entries: readonly BookshelfEntry[]; width: number }) {
  const [driver] = useState(() => new ShelfDriver());
  const theme = useTheme();
  const dark = useActiveColorScheme() === 'dark';
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const { nameOf, directOf } = useBridgeMap();
  const coverOf = useBookCoverResolver();
  const warmPages = useWarmChapterPages();
  const stage = useMemo(() => ({ width, height: shelfStageHeight(width) }), [width]);
  const [front, setFront] = useState(0);
  const [drawn, setDrawn] = useState(false);
  // What each cover turned out to be once its picture loaded: its shape, and the cloth read off it.
  const [pictures, setPictures] = useState<Record<string, { aspect: number; board: Rgb }>>({});
  const fx = useSharedValue<ShelfCallouts>(shelfCallouts([], [], 0, stage));

  const specs = useMemo((): ShelfBookSpec[] => {
    const coverWidth = shelfCoverWidth(width);
    return entries.map(({ key, history, chapters }) => {
      const picture = pictures[key];
      const aspect = clamp(picture?.aspect ?? SHELF_ASPECT.unknown, SHELF_ASPECT.tall, SHELF_ASPECT.wide);
      const cover = coverOf({ bridgeId: history.bridgeId, seriesId: history.seriesId, direct: directOf(history.bridgeId), aspect });
      const board = picture?.board ?? NEUTRAL_BOARD;
      return {
        key,
        title: history.title,
        cover,
        width: coverWidth,
        height: coverWidth / aspect,
        depth: bookDepth(cover.form, coverWidth, chapters),
        board,
        ink: inkOn(board),
      };
    });
  }, [entries, pictures, width, coverOf, directOf]);

  useEffect(() => {
    driver.listen({ onFront: setFront, onFrame: (callouts) => fx.set(callouts), onDrawn: setDrawn });
    return () => driver.dispose();
  }, [driver, fx]);
  useEffect(() => driver.setStill(reduceMotion), [driver, reduceMotion]);
  useEffect(() => driver.setStage(stage, Math.min(3, PixelRatio.get())), [driver, stage]);
  useEffect(() => driver.setTheme(dark, theme.background), [driver, dark, theme.background]);
  useEffect(() => driver.setBooks(specs), [driver, specs]);

  // Each cover is fetched once, however often the shelf's books are worked out again.
  const asked = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    for (const { key, history } of entries) {
      const url = history.thumbnailUrl;
      if (!url || asked.current.has(key)) continue;
      asked.current.add(key);
      const { binding } = coverOf({ bridgeId: history.bridgeId, seriesId: history.seriesId, direct: false, aspect: SHELF_ASPECT.unknown });
      void (async () => {
        const { loadCover } = await import('./engine');
        const picture = await loadCover(await resolveAssetSourceCached(url), binding);
        if (!picture) return;
        if (!alive.current) {
          picture.texture.dispose();
          return;
        }
        driver.setCover(key, picture.texture, picture.aspect);
        setPictures((known) => ({ ...known, [key]: { aspect: picture.aspect, board: picture.board } }));
      })().catch(() => {});
    }
  }, [entries, coverOf, driver]);

  const shown = entries[Math.min(front, entries.length - 1)];
  const titleFont = useTitleFontFor(shown?.history.title ?? '');
  if (!shown) return null;

  const resume = () => {
    const h = shown.history;
    const direct = h.chapterId === DIRECT_CHAPTER_ID || !h.chapterId;
    warmPages(h.bridgeId, h.seriesId, direct ? undefined : h.chapterId, h.lastPage ?? 0);
    router.push({ pathname: '/series', params: withZoomSource(historyResumeParams(h, nameOf(h.bridgeId)), null) });
  };
  const tap = (x: number, y: number) => {
    const index = driver.bookAt(x, y);
    if (index < 0) return;
    if (index === driver.focused) resume();
    else driver.goTo(index);
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    // Sideways only: a drag that starts up or down is the feed's.
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onStart(() => driver.grab())
    .onUpdate((e) => driver.drag(e.translationX))
    .onEnd((e) => driver.release(e.velocityX))
    .onFinalize(() => driver.release(0));
  const press = Gesture.Tap()
    .runOnJS(true)
    .maxDistance(8)
    .onEnd((e, landed) => {
      if (landed) tap(e.x, e.y);
    });
  const tone = dark ? TONE.dark : TONE.light;
  const where = historySub(shown.history, { withTime: false, long: false });

  return (
    <View style={{ height: homeBookshelfHeight(width) }} testID="home-bookshelf">
      <FeedHeading title="Continue reading" />
      <GestureDetector gesture={Gesture.Race(pan, press)}>
        <View
          style={{ width, height: stage.height }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Continue reading: ${shown.history.title}`}
          accessibilityValue={{ text: `${front + 1} of ${entries.length}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === 'increment') driver.goTo(driver.focused + 1);
            else if (nativeEvent.actionName === 'decrement') driver.goTo(driver.focused - 1);
            else resume();
          }}>
          <Fallible onError={markHomeBookshelfUnavailable}>
            <Suspense fallback={null}>
              <ShelfCanvas style={StyleSheet.absoluteFill} driver={driver} onUnavailable={markHomeBookshelfUnavailable} />
            </Suspense>
          </Fallible>
          <View style={[styles.callouts, !drawn && styles.unseen]} pointerEvents="none">
            {entries.map((entry, index) =>
              entry.unread ? <UnreadTab key={entry.key} fx={fx} index={index} count={entry.unread} tone={tone} /> : null,
            )}
            <Caption fx={fx} where={where} tone={tone} />
            <Burst fx={fx} count={shown.unread} tone={tone} />
          </View>
        </View>
      </GestureDetector>
      <View style={styles.under}>
        <View style={styles.underText}>
          <ThemedText numberOfLines={1} style={[styles.title, titleFont ? { fontFamily: titleFont } : undefined]}>
            {shown.history.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {[nameOf(shown.history.bridgeId), historySub(shown.history, { withTime: true, long: true })].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>
        <Pressable
          testID="home-bookshelf.resume"
          accessibilityRole="button"
          onPress={resume}
          style={({ pressed }) => [styles.resume, { backgroundColor: pressed ? theme.accentHover : theme.accent }]}>
          <Text style={[styles.resumeLabel, { color: theme.accentOn }]}>Resume</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  callouts: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' },
  burst: { position: 'absolute', left: 0, top: 0, width: 96, height: 96 },
  burstLabel: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  burstCount: { color: STICKER.ink, fontSize: 25, lineHeight: 27, fontWeight: '900' },
  burstNew: { color: STICKER.ink, fontSize: 10, lineHeight: 11, fontWeight: '900', letterSpacing: 0.6 },
  caption: { position: 'absolute', left: 0, top: 0 },
  captionBox: {
    paddingHorizontal: 10,
    paddingTop: 5,
    paddingBottom: 6,
    backgroundColor: STICKER.paper,
    borderColor: STICKER.ink,
    borderWidth: 2.5,
  },
  captionLabel: { color: STICKER.ink, fontSize: 13, lineHeight: 15, fontWeight: '900', letterSpacing: 0.6 },
  captionWhere: { color: STICKER.ink, fontSize: 11.5, lineHeight: 14 },
  toneShadow: { position: 'absolute', left: 6, top: 6 },
  tab: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: STICKER.ink,
    backgroundColor: STICKER.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCount: { color: STICKER.ink, fontSize: 11, lineHeight: 13, fontWeight: '900' },
  under: { height: CAPTION_HEIGHT, paddingHorizontal: TopLevelGutter, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  underText: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, lineHeight: 26 },
  unseen: { opacity: 0 },
  resume: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
  resumeLabel: { fontSize: 15, fontWeight: '600' },
});
