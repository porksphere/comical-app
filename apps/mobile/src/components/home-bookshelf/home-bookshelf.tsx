import { observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  measure,
  runOnJS,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Pattern, Polygon, Rect } from 'react-native-svg';

import { FeedHeading, SECTION_HEAD_ROW_HEIGHT } from '@/components/content-feed';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing, TopLevelGutter } from '@/constants/theme';
import { activityLabel } from '@/data/activity/feed-rows';
import { resolveAssetSourceCached } from '@/data/api';
import { useWarmChapterPages } from '@/data/prefetch';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useBookCoverResolver } from '@/hooks/use-book-covers';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useCenterInset, useSideInsets } from '@/hooks/use-content-width';
import { DeviceTilt, LEVEL, type Tilt } from '@/hooks/use-device-tilt';
import { homeBookshelfStats, markHomeBookshelfUnavailable, useHomeBookshelfStats, type BookshelfEntry } from '@/hooks/use-home-bookshelf';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { useScrollbarGutter } from '@/lib/scrollbar-gutter';
import {
  NEUTRAL_BOARD,
  SHELF,
  SHELF_ASPECT,
  bookDepth,
  inkOn,
  shelfCallouts,
  shelfCoverWidth,
  shelfMiddle,
  shelfStageHeight,
  spineNumber,
  type Rgb,
  type ShelfCallouts,
} from '@/lib/bookshelf';
import { logDiagnostic } from '@/lib/diagnostics';
import { desktopShell } from '@/lib/desktop-shell';
import { createTickHaptic, hapticSelection } from '@/lib/haptics';
import { historySub } from '@/lib/history-sub';
import { useRouter } from '@/lib/nav';
import { activityReadParams, historyResumeParams } from '@/lib/series-links';
import { useTitleFontFor } from '@/lib/title-font';

import { ShelfDriver } from './driver';
import { FrameStats, describeFrames } from './frame-stats';
import { PAGE_DOTS_HEIGHT, PageDots } from './page-dots';
import type { ShelfBookSpec } from './scene';

// Its own chunk on the web: three and the scene are most of a megabyte that only the shelf needs.
const ShelfCanvas = lazy(() => import('./engine').then((m) => ({ default: m.ShelfCanvas })));

/** The least time between two frames of a shelf that only stands and drifts, in milliseconds:
 *  half the rate of one that is moving, which a turn of a degree or so over seconds doesn't miss. */
const IDLE_FRAME_MS = 30;

/** How long the shelf stands before a move counts as over, for the frame stats' log. */
const MOVE_OVER_MS = 500;

/** The title and where the reader stopped, under the stage. */
const CAPTION_HEIGHT = 52;
/** How far below the stage a callout may hang: the caption rides over the scene's fade into the
 *  page, and a thick book's stands lower than a thin one's. */
const CALLOUT_OVERHANG = 20;

/** Its height in a feed `width` wide, heading and all — known ahead of it, so the feed's offsets
 *  below never wait on a measurement. */
export function homeBookshelfHeight(width: number): number {
  return SECTION_HEAD_ROW_HEIGHT + shelfStageHeight(width, SHELF_ZOOM) + CAPTION_HEIGHT + PAGE_DOTS_HEIGHT + Spacing.two;
}

/** How many times life size the scene is drawn. The shelf is built to a phone's stage, and in the
 *  desktop app's window, read from further off on a larger screen, it stood small. */
const SHELF_ZOOM = desktopShell() ? 1.5 : 1;

// A sticker is ink on paper whatever the theme; only the tone it casts follows the page.
const STICKER = { paper: '#ffffff', ink: '#1c1c1e' } as const;
const TONE = { light: '#1c1c1e', dark: '#8a8a8f' } as const;

/** The burst's outline: twelve even points, every other one a little longer. Even, because the
 *  first cut's uneven ones read as a mistake at this size rather than as a hand's. Twelve, because
 *  it is turned afresh for each book: sixteen were too fine for the turn to show, and a star made
 *  wider than it is tall, so that it would, only looked slanted. */
const BURST_POINTS = 12;
const BURST = Array.from({ length: BURST_POINTS * 2 }, (_, k) => {
  const angle = (k / (BURST_POINTS * 2)) * Math.PI * 2 - Math.PI / 2;
  const reach = k % 2 ? 30 : k % 4 ? 40 : 46;
  return `${(Math.cos(angle) * reach).toFixed(1)},${(Math.sin(angle) * reach).toFixed(1)}`;
}).join(' ');
/** The turn after which the burst is the same shape again, in degrees: a long point and a short. */
const BURST_TURN = 720 / BURST_POINTS;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// In a store of its own, read by one small view: set in the shelf's own state, a line a second
// would render the whole shelf a second, on the thread whose frames it is counting.
const readout$ = observable('');

function FrameReadout({ left }: { left: number }) {
  const theme = useTheme();
  const line = useSelector(() => readout$.get());
  if (!line) return null;
  return (
    <Text pointerEvents="none" style={[styles.readout, { left, color: theme.text, backgroundColor: theme.backgroundElement }]}>
      {line}
    </Text>
  );
}

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

function Burst({
  fx,
  tilt,
  count,
  turn,
  tone,
}: {
  fx: SharedValue<ShelfCallouts>;
  tilt: SharedValue<Tilt>;
  count: number;
  /** The star's turn, in degrees: its lettering stays level whichever way its points fall. */
  turn: number;
  tone: string;
}) {
  const style = useAnimatedStyle(() => {
    const { burst, pop, settled } = fx.get();
    const stir = tilt.get();
    return {
      opacity: count ? Math.min(1, settled * 4) : 0,
      transform: [
        { translateX: burst.x - 48 + stir.x * 4.5 },
        { translateY: burst.y - 48 - stir.y * 3 },
        { scale: pop * burst.scale },
        { rotate: `${stir.x * 3}deg` },
      ],
    };
  });
  return (
    <Animated.View style={[styles.burst, style]}>
      <Svg width={96} height={96} viewBox="-50 -50 100 100">
        {/* A hard shadow, as the tabs cast: tone dotted into a margin this thin was only fragments. */}
        <Polygon points={BURST} fill={tone} transform={`translate(3 4) rotate(${turn})`} />
        <Polygon points={BURST} fill={STICKER.paper} stroke={STICKER.ink} strokeWidth={2.4} strokeLinejoin="miter" transform={`rotate(${turn})`} />
      </Svg>
      <View style={styles.burstLabel}>
        <Text style={styles.burstCount}>{count}</Text>
        <Text style={styles.burstNew}>NEW!</Text>
      </View>
    </Animated.View>
  );
}

/** Where the caption hangs from the point the shelf gives it: most of it clear of the cover, by
 *  the side it stands on. Fractions of its own size, which a tap is tested against too. */
const captionHang = (side: 1 | -1) => {
  'worklet';
  return { x: side < 0 ? 0.34 : 0.66, y: 0.38 };
};

function Caption({
  fx,
  tilt,
  label,
  where,
  lean,
  tone,
  onSize,
}: {
  fx: SharedValue<ShelfCallouts>;
  tilt: SharedValue<Tilt>;
  /** What a tap does, in a word. */
  label: string;
  where: string;
  /** The way it was slapped on, in degrees: one way or the other, a little or a little more. */
  lean: number;
  tone: string;
  onSize: (width: number, height: number) => void;
}) {
  const style = useAnimatedStyle(() => {
    const { caption, pop, settled } = fx.get();
    const stir = tilt.get();
    const hang = captionHang(caption.side);
    return {
      opacity: Math.min(1, settled * 4),
      transform: [
        { translateX: caption.x + stir.x * 3 },
        { translateY: caption.y - stir.y * 2 },
        { translateX: `${-hang.x * 100}%` },
        { translateY: `${-hang.y * 100}%` },
        { scale: pop },
        { rotate: `${lean + stir.x * 1.5}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[styles.caption, style]}
      testID="home-bookshelf.resume"
      onLayout={({ nativeEvent }) => onSize(nativeEvent.layout.width, nativeEvent.layout.height)}>
      <ToneShadow id="bookshelf-caption-tone" colour={tone} />
      <View style={styles.captionBox}>
        <Text style={styles.captionLabel}>{label}</Text>
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
 * The shelf before it is drawn: the renderer, its shaders and the spines' face take a moment to
 * start when the app does, and the stage was a blank band until they had. A cover and a few spines
 * where the books will stand, in the feed's own placeholder grey.
 */
function ShelfPlaceholder({ stage, coverWidth }: { stage: { height: number; centre: number; zoom: number }; coverWidth: number }) {
  const z = stage.zoom;
  const width = coverWidth * z;
  const foot = (SHELF.floor - 8) * z;
  const height = width / SHELF_ASPECT.unknown;
  const spines = [0.94, 1, 0.9, 0.97];
  return (
    <View style={styles.placeholder} pointerEvents="none">
      <Skeleton style={[styles.placeholderBook, { left: stage.centre - width / 2, bottom: foot, width, height }]} />
      {spines.map((tall, i) => (
        <Skeleton
          key={i}
          style={[
            styles.placeholderBook,
            { left: stage.centre + width / 2 + (8 + i * 26) * z, bottom: foot + 6 * z, width: 22 * z, height: height * 0.9 * tall },
          ]}
        />
      ))}
      {spines.slice(0, 2).map((tall, i) => (
        <Skeleton
          key={i}
          style={[
            styles.placeholderBook,
            { left: stage.centre - width / 2 - (30 + i * 26) * z, bottom: foot + 6 * z, width: 22 * z, height: height * 0.9 * tall },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * What Comical Home opens on: what you are reading, as books on a shelf. They stand spine out; the
 * one in the middle comes forward and turns to show its cover, in colour against a shelf drawn in
 * the app's screentone, and wears where you stopped and how many chapters are new. A drag runs
 * along the shelf, a tap on a spine brings that book forward, and a tap on the front book or its
 * caption — it gives under the finger and springs back out — opens it: where the History tab's row would for one that has been read, and where the
 * Activity tab's would for one that has only its new chapters.
 *
 * The books are lit geometry (`ShelfScene`), drawn through one camera that `lib/bookshelf` also
 * projects with, which is how the callouts — plain views over the canvas — stand on a book's
 * corners. Everything that moves is `ShelfDriver`'s.
 */
export function HomeBookshelf({ entries, width }: { entries: readonly BookshelfEntry[]; width: number }) {
  const [driver] = useState(() => new ShelfDriver());
  const showStats = useHomeBookshelfStats();
  const theme = useTheme();
  const dark = useActiveColorScheme() === 'dark';
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const { nameOf, directOf } = useBridgeMap();
  const coverOf = useBookCoverResolver();
  const warmPages = useWarmChapterPages();
  // The shelf runs under the safe area's sides — the bar the wide iPhones stand beside the content —
  // while the book in front stands in the middle of what is left, where the rest of the page is.
  // On the web that page is a column centred in its pane, and this row stands in the column: the
  // stage starts back at the pane's edge (`lead`), or it began at the column's and ran off the right.
  const sides = useSideInsets();
  const lead = sides.left + useCenterInset(sides);
  const gutter = useScrollbarGutter();
  const stage = useMemo(
    () => ({
      width: width + sides.left + sides.right - gutter,
      height: shelfStageHeight(width, SHELF_ZOOM),
      centre: sides.left + (width - gutter) / 2,
      zoom: SHELF_ZOOM,
    }),
    [width, sides.left, sides.right, gutter],
  );
  const tilt = useSharedValue<Tilt>(LEVEL);
  // The book in front, by what it is: where it stands changes when the shelf is put in a new order.
  const [frontKey, setFrontKey] = useState<string>();
  const [drawn, setDrawn] = useState(false);
  // How the stickers went on this time: each book that comes forward gets them afresh.
  const [stuck, setStuck] = useState({ lean: -3, turn: 0 });
  const [tick] = useState(() => createTickHaptic(hapticSelection));
  // What each cover turned out to be once its picture loaded: its shape, and the cloth read off it.
  const [pictures, setPictures] = useState<Record<string, { aspect: number; board: Rgb }>>({});
  const fx = useSharedValue<ShelfCallouts>(shelfCallouts([], [], 0, stage));

  const specs = useMemo((): ShelfBookSpec[] => {
    // In the shelf's own points, which the stage draws `SHELF_ZOOM` times over.
    const coverWidth = shelfCoverWidth(width / SHELF_ZOOM);
    return entries.map(({ key, bridgeId, seriesId, title, history, news, chapters, coverForm, readingDirection }) => {
      const picture = pictures[key];
      const aspect = clamp(picture?.aspect ?? SHELF_ASPECT.unknown, SHELF_ASPECT.tall, SHELF_ASPECT.wide);
      const cover = coverOf({ bridgeId, seriesId, direct: directOf(bridgeId), aspect, coverForm, readingDirection });
      const board = picture?.board ?? NEUTRAL_BOARD;
      // The chapter the book opens at: where it was left, else the new one its Activity row reads.
      const opensAt = history ? (history.chapterId === DIRECT_CHAPTER_ID ? undefined : history.chapterName) : (news?.chapterName ?? news?.number?.toString());
      return {
        key,
        title,
        number: spineNumber(opensAt),
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
    driver.listen({
      onFront: (key, byHand) => {
        setFrontKey(key);
        setStuck({ lean: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3), turn: Math.random() * BURST_TURN });
        // A book the reader brought forward clicks into place; the one the shelf opens on does not.
        if (byHand) tick();
      },
      onFrame: (callouts) => fx.set(callouts),
      onDrawn: setDrawn,
    });
    return () => driver.dispose();
  }, [driver, fx, tick]);
  useEffect(() => driver.setStill(reduceMotion), [driver, reduceMotion]);

  // The shelf's frames come off the display's own callback, on the UI thread, and are drawn here on
  // the JS thread where three runs. One is in hand at a time: a frame that arrives while the last
  // is still being drawn is let go, so a slow frame costs that frame and never a queue of them.
  // A shelf that is moving takes every frame. One that only stands takes about every other, for
  // its drift, and none once it has scrolled off the top, lost the screen, or under Reduce Motion.
  const focused = useIsFocused();
  const mayDrift = focused && !reduceMotion;
  const stageView = useAnimatedRef<Animated.View>();
  const drawing = useSharedValue(false);
  const moving = useSharedValue(false);
  const drifting = useSharedValue(false);
  const driftedAt = useSharedValue(0);
  // How the frames are going (Settings → Developer): the last second's for the line over the
  // stage, and each move's for the log.
  const skipped = useSharedValue(0);
  const [meter] = useState(() => ({ second: new FrameStats(), move: new FrameStats(), moving: false, movedAt: 0, timingGpu: false }));
  const [draw] = useState(() => (now: number, tiltX: number, tiltY: number, missed: number) => {
    // Before the step, which may end the move: under a finger the shelf stops after every frame.
    const moving = meter.moving;
    const began = performance.now();
    try {
      driver.step(now, tiltX, tiltY);
    } finally {
      drawing.set(false);
      if (homeBookshelfStats()) {
        const script = performance.now() - began;
        // A move is over once the shelf has stood this long, which a drag's frames never do.
        if (now - meter.movedAt > MOVE_OVER_MS) {
          const moved = meter.move.take();
          // A tap's few frames say nothing.
          if (moved && moved.frames >= 20) logDiagnostic('bookshelf', describeFrames(moved));
        }
        if (moving) {
          meter.move.add(now, script, missed);
          meter.movedAt = now;
        }
        meter.second.add(now, script, missed);
        // One frame's GPU work is timed at a time: the answer comes back on this thread, and a
        // wait asked for every frame would time the waits.
        const done = meter.timingGpu ? undefined : driver.drawn();
        if (done) {
          meter.timingGpu = true;
          const handed = performance.now();
          const timed = () => {
            meter.timingGpu = false;
            const after = performance.now() - handed;
            meter.second.addGpu(after);
            if (moving) meter.move.addGpu(after);
          };
          done.then(timed, () => (meter.timingGpu = false));
        }
        if (meter.second.span >= 1000) readout$.set(describeFrames(meter.second.take()!));
      }
    }
  });
  const frames = useFrameCallback((frame) => {
    if (drawing.get()) {
      // A frame the display offered while the last was still being drawn.
      if (moving.get()) skipped.set(skipped.get() + 1);
      return;
    }
    if (!moving.get()) {
      if (!drifting.get() || frame.timestamp - driftedAt.get() < IDLE_FRAME_MS) return;
      const at = measure(stageView);
      if (!at || at.pageY + at.height <= 0) return;
      driftedAt.set(frame.timestamp);
    }
    drawing.set(true);
    const stir = tilt.get();
    runOnJS(draw)(frame.timestamp, stir.x, stir.y, skipped.get());
    skipped.set(0);
  }, false);
  useEffect(() => {
    drifting.set(mayDrift);
    frames.setActive(mayDrift);
    driver.setFrames({
      start: () => {
        moving.set(true);
        meter.moving = true;
        frames.setActive(true);
      },
      stop: () => {
        moving.set(false);
        meter.moving = false;
        if (!mayDrift) frames.setActive(false);
      },
    });
  }, [driver, frames, mayDrift, drifting, moving, meter]);
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
    // From the middle outward, a few at a time: the shelf opens on its middle, and a shelf's worth
    // of pictures decoded at once was a stall as the app started.
    const middle = shelfMiddle(entries.length);
    const wanted = entries
      .map((entry, index) => ({ entry, away: Math.abs(index - middle) }))
      .filter(({ entry }) => entry.thumbnailUrl && !asked.current.has(entry.key))
      .sort((a, b) => a.away - b.away)
      .map(({ entry }) => entry);
    for (const { key } of wanted) asked.current.add(key);
    let next = 0;
    const work = async () => {
      const { loadCover } = await import('./engine');
      while (alive.current && next < wanted.length) {
        const { key, bridgeId, seriesId, thumbnailUrl, coverForm, readingDirection } = wanted[next++];
        const { binding } = coverOf({ bridgeId, seriesId, direct: false, aspect: SHELF_ASPECT.unknown, coverForm, readingDirection });
        const picture = await resolveAssetSourceCached(thumbnailUrl!)
          .then((source) => loadCover(source, binding))
          .catch(() => null);
        if (!picture) {
          // Asked again the next time the shelf's books are worked out: offline is not for good.
          asked.current.delete(key);
          continue;
        }
        if (!alive.current) {
          picture.texture.dispose();
          return;
        }
        driver.setCover(key, picture.texture, picture.aspect);
        setPictures((known) => ({ ...known, [key]: { aspect: picture.aspect, board: picture.board } }));
      }
    };
    for (let worker = 0; worker < 3; worker++) void work().catch(() => {});
  }, [entries, coverOf, driver]);

  const shown = entries.find((entry) => entry.key === frontKey) ?? entries[shelfMiddle(entries.length)];
  const front = shown ? entries.indexOf(shown) : 0;
  const titleFont = useTitleFontFor(shown?.title ?? '');
  const captionSize = useSharedValue({ width: 0, height: 0 });
  if (!shown) return null;

  const bridgeName = nameOf(shown.bridgeId);
  // What the front book opens, worked out once for the press that warms it and the tap that pushes
  // it: what the History tab's row opens for a series that has been read, and the Activity tab's
  // for one that has only its new chapters.
  const opening = () => {
    const { history: h, news: g, bridgeId, seriesId } = shown;
    if (h) {
      const direct = h.chapterId === DIRECT_CHAPTER_ID || !h.chapterId;
      return { warm: () => warmPages(bridgeId, seriesId, direct ? undefined : h.chapterId, h.lastPage ?? 0), params: historyResumeParams(h, bridgeName) };
    }
    if (!g) return null;
    return {
      warm: () => (g.chapterId === undefined ? undefined : warmPages(bridgeId, seriesId, g.chapterId, 0)),
      params: activityReadParams(g, { name: bridgeName, direct: directOf(bridgeId) }),
    };
  };
  /** Whether a point of the stage is on the front book or on its caption, which is drawn over the
   *  stage and not in it, so a touch on it is told by where it hangs. */
  const onFront = (x: number, y: number) => {
    const { caption, settled } = fx.get();
    const { width: w, height: h } = captionSize.get();
    const hang = captionHang(caption.side);
    const left = caption.x - w * hang.x;
    const top = caption.y - h * hang.y;
    if (settled > 0.5 && x > left - 6 && x < left + w + 6 && y > top - 6 && y < top + h + 6) return true;
    return driver.bookAt(x, y) === driver.focused;
  };
  // The book gives under the finger and springs out as it lifts, and the page is pushed once it
  // has: the fetch, begun as the finger came down, has that long a start.
  const pressIn = (x: number, y: number) => {
    if (!onFront(x, y)) return;
    opening()?.warm();
    driver.pressIn();
  };
  const resume = () => {
    const opens = opening();
    if (!opens) return;
    opens.warm();
    driver.pressOut(() => router.push({ pathname: '/series', params: opens.params }));
  };
  const tap = (x: number, y: number) => {
    if (onFront(x, y)) return resume();
    driver.pressOut();
    const index = driver.bookAt(x, y);
    if (index >= 0) driver.goTo(index);
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
    .onBegin((e) => pressIn(e.x, e.y))
    .onEnd((e, landed) => {
      if (landed) tap(e.x, e.y);
    })
    .onFinalize((_e, landed) => {
      if (!landed) driver.pressOut();
    });
  const tone = dark ? TONE.dark : TONE.light;
  const { history, news } = shown;
  const where = history ? historySub(history, { withTime: false, long: false }) : news ? activityLabel(news, bridgeName) : '';
  const detail = history ? historySub(history, { withTime: true, long: true }) : where;

  return (
    <View style={{ height: homeBookshelfHeight(width) }} testID="home-bookshelf">
      {mayDrift && <DeviceTilt tilt={tilt} />}
      <FeedHeading title="Continue reading" />
      <GestureDetector gesture={Gesture.Race(pan, press)}>
        <Animated.View
          ref={stageView}
          style={{ width: stage.width, height: stage.height, marginLeft: -lead }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Continue reading: ${shown.title}`}
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
          <LinearGradient pointerEvents="none" style={styles.fadeTop} colors={[theme.background, `${theme.background}00`]} />
          <LinearGradient pointerEvents="none" style={styles.fadeBottom} colors={[`${theme.background}00`, theme.background]} />
          {!drawn && <ShelfPlaceholder stage={stage} coverWidth={shelfCoverWidth(width / SHELF_ZOOM)} />}
          {showStats && <FrameReadout left={lead + TopLevelGutter} />}
          <View style={[styles.callouts, !drawn && styles.unseen]} pointerEvents="none">
            {entries.map((entry, index) =>
              entry.unread ? <UnreadTab key={entry.key} fx={fx} index={index} count={entry.unread} tone={tone} /> : null,
            )}
            <Caption
              fx={fx}
              tilt={tilt}
              label={history ? 'RESUME' : 'READ'}
              where={where}
              lean={stuck.lean}
              tone={tone}
              onSize={(w, h) => captionSize.set({ width: w, height: h })}
            />
            <Burst fx={fx} tilt={tilt} count={shown.unread} turn={stuck.turn} tone={tone} />
          </View>
        </Animated.View>
      </GestureDetector>
      <View style={styles.under}>
        <ThemedText numberOfLines={1} style={[styles.title, titleFont ? { fontFamily: titleFont } : undefined]}>
          {shown.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {[bridgeName, detail].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
      <PageDots count={entries.length} page={front} onPage={(page) => driver.goTo(page)} />
    </View>
  );
}

const styles = StyleSheet.create({
  callouts: { position: 'absolute', left: 0, top: 0, right: 0, bottom: -CALLOUT_OVERHANG, overflow: 'hidden' },
  placeholder: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' },
  placeholderBook: { position: 'absolute', borderRadius: 3 },
  burst: { position: 'absolute', left: 0, top: 0, width: 96, height: 96 },
  burstLabel: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  burstCount: { color: STICKER.ink, fontSize: 24, lineHeight: 24, fontWeight: '900', marginTop: -1 },
  burstNew: { color: STICKER.ink, fontSize: 9.5, lineHeight: 10, fontWeight: '900', letterSpacing: 0.5 },
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
  under: { height: CAPTION_HEIGHT, paddingHorizontal: TopLevelGutter, justifyContent: 'center' },
  title: { fontSize: 20, lineHeight: 26 },
  unseen: { opacity: 0 },
  readout: { position: 'absolute', top: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontSize: 10, fontVariant: ['tabular-nums'], overflow: 'hidden' },
  // The scene comes out of the page and goes back into it: no edge where the canvas starts or ends.
  fadeTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 48 },
  fadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 34 },
});
