import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  LinearTransition,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';

import { NATIVE_HIDE_OFFSET } from '@/components/app-tabs';
import { ChipRow, TagGroupRow } from '@/components/chip';
import { CheckIcon, PlayIcon, PlusIcon, StarIcon, type IconProps } from '@/components/icons/ui-icons';
import { PageThumb } from '@/components/series/chapters-section';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { setSearchIntent, tagSearchIntent } from '@/data/search-intent';
import type { TagGroup } from '@/data/mock';
import { seriesDetailQuery, seriesListQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { PageThumbSource } from '@/data/types';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import { useIsLargeScreen, useTopBarHeight } from '@/hooks/use-responsive';
import { useStartReading } from '@/hooks/use-start-reading';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { closeSeriesCardMenu, useSeriesCardMenu, type SeriesCardMenuRequest } from '@/lib/series-card-menu';
import { getTabBarProgress } from '@/lib/tab-bar-visibility';
import { getTopBarHidden } from '@/lib/top-bar-visibility';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
// The one spring used everywhere: the open morph, the panel/menu resize, and any late correction to
// the popup's geometry — so every motion shares the same bouncy feel.
const MORPH_SPRING = { damping: 16, stiffness: 170, mass: 0.8 } as const;
// The close is the SAME spring, roughly twice as fast: the overlay swallows touches until it
// unmounts, so every millisecond of the return (bounce included) is time the list can't be scrolled.
// Damping and stiffness are raised together to keep the damping RATIO — i.e. the size of the little
// overshoot at the end, the springy part — while doubling the decay rate (damping / 2·mass), which is
// what actually sets how long the motion takes to die out. Bouncy, just less lingering.
const CLOSE_SPRING = { damping: 28, stiffness: 660, mass: 0.7 } as const;
// How the panel RESIZES when late content lands — it's a plain Animated.View (not the ThemedView,
// which doesn't forward a ref) so its height can spring when async content swaps a skeleton for the
// real thing, instead of popping to its final size. Everything's POSITION springs separately, through
// the shared values in "Live geometry" below.
const RESIZE = LinearTransition.springify().damping(MORPH_SPRING.damping).stiffness(MORPH_SPRING.stiffness).mass(MORPH_SPRING.mass);

// Last-seen count of tag rows (genres row + one per tag group), remembered across opens so the
// loading skeleton can show a plausible number of rows instead of a fixed guess. A plain module
// global: it's a cheap heuristic for the placeholder shape, not state anything renders off directly.
let lastTagRowCount = 2;

// The routes that show the bottom tab bar (a pushed screen — series, search — covers it). Used to
// decide whether the bottom of the screen is chrome the cover has to slide under.
const TAB_ROUTES = new Set(['/', '/library', '/history', '/activity', '/settings']);

const EDGE_PAD = 12; // keep the whole thing off the screen edges (and off the bars — see chromeTop)
const GAP = 12; // between the preview panel and the menu
const PANEL_MAX_WIDTH = 360; // cap the panel width on wide screens
const PANEL_PAD = Spacing.three;
const COVER_W = 118; // cover width inside the panel
const RAIL_THUMB_W = 64; // nominal fallback width (unused in slot mode: PageThumb sizes to slotHeight)
const RAIL_THUMB_H = 180; // the rail's fixed tile height; each tile's width follows its own page aspect
const RAIL_GAP = Spacing.two;
// Fixed-height meta + description slots. Reserved identically in the loading skeleton and the loaded
// state so a fresh (uncached) series opens at the height it settles to — the title is synchronous and
// the tag-row count is remembered, so the description (wildly variable per series) was the one thing
// that made the panel jump; a constant reserve trades a little empty space for a stable size.
const SMALL_LINE_H = 20; // ThemedText "small" lineHeight
const META_H = SMALL_LINE_H; // one line
const DESC_LINES = 3;
const DESC_H = DESC_LINES * SMALL_LINE_H;
// Rough panel height before it's measured, so the menu is roughly placed on frame one.
const PANEL_HEIGHT_ESTIMATE = 190;
const MENU_WIDTH = 240;
const ROW_HEIGHT = 48;
// Read + Add to Library + Favorite. Keep in step with the rows rendered below — the menu is placed
// from this height (it's what `panelTop`'s bottom-edge clamp budgets for), not measured.
const MENU_ROWS = 3;
const MENU_PAD_V = Spacing.one;
// Blur strengths (0–100). The backdrop ramps in a bit after the cover pops.
const BACKDROP_BLUR = 28;
const MENU_BLUR = 55;
const BACKDROP_TINT_OPACITY = 0.15;
// Android's blur is the experimental Dimezis path; a no-op elsewhere.
const ANDROID_BLUR = Platform.OS === 'android' ? ('dimezisBlurView' as const) : undefined;

/**
 * Root-mounted host for the native card context menu (the iOS / X hold-down): a dimmed backdrop, a
 * rich preview panel (cover + title + series info, and a page-thumbnail rail for direct series), and
 * a rounded actions menu below it. Rendered once (see `app/_layout.tsx`); any card opens it via
 * `openSeriesCardMenu` on long-press. Only mounted while open, so its queries cost nothing during
 * scroll.
 *
 * Animation is a shared-element: the COVER morphs precisely out of the pressed card (FLIP), while the
 * panel background + its content (title/info/rail) just fade in at the final position around it.
 */
export function SeriesCardContextMenuHost() {
  const req = useSeriesCardMenu();
  if (!req) return null;
  return <ContextMenu key={req.entry.id} req={req} />;
}

function ContextMenu({ req }: { req: SeriesCardMenuRequest }) {
  const { entry, bridgeId, bridge, direct, coverAspect, rect } = req;
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const menuTint = scheme === 'dark' ? 'dark' : 'light';
  const router = useRouter();
  // Which screen the menu was opened over — a tapped tag only needs to PUSH Search when we aren't
  // already on it (see `onTagPress`).
  const pathname = usePathname();
  const progress = useSharedValue(0);

  const ds = useDataSource();
  const mock = useMockActive();
  const detail = useQuery(
    seriesDetailQuery(ds, mock, bridgeId ?? '', entry.id, {
      direct: !!direct,
      title: entry.title,
      cover: entry.cover,
    }),
  );
  // The page rail (direct series only). A chaptered series fetches NOTHING here: Read either resumes
  // from history or hands the reader an unspecified chapter, which it resolves itself.
  const pageList = useQuery(seriesListQuery(ds, mock, bridgeId ?? '', entry.id, !!direct, !!direct && !!bridgeId));
  // Where Read takes you — the resume point, or the first chapter / page 0. Shared with the series
  // screen's primary button, so the two can't resume at different places (see useStartReading).
  const reading = useStartReading({
    bridgeId,
    seriesId: entry.id,
    title: entry.title,
    direct: !!direct,
    readLabel: detail.data?.readLabel,
  });
  // The detail query is SEEDED with placeholder data (the card's title + cover) so the panel has them
  // instantly — so "has data" is true from frame one. The real meta/description/tags only exist once
  // the fetch resolves (`isPlaceholderData` flips false); gate the skeletons on THAT, not on presence,
  // or they never show and the panel opens condensed then jumps when the real detail lands.
  const detailLoaded = !!detail.data && !detail.isPlaceholderData;

  const { favorited, toggle: toggleFavorite } = useFavorite(bridgeId, entry.id);
  const { inLibrary, toggle: toggleLibrary } = useLibrary(bridgeId, entry.id, () => ({
    title: entry.title,
    ...(entry.cover ? { thumbnailUrl: entry.cover } : {}),
  }));

  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    progress.value = withSpring(1, MORPH_SPRING);
  }, [progress]);

  // Remember how many tag rows this kind of series carries, so the next open's skeleton is shaped
  // closer to reality (fewer size corrections when the real tags land).
  useEffect(() => {
    if (!detailLoaded) return;
    const rows = (detail.data?.genres?.length ? 1 : 0) + (detail.data?.tagGroups?.length ?? 0);
    if (rows > 0) lastTagRowCount = rows;
  }, [detailLoaded, detail.data]);

  // The source card stays hidden until the morph-back has fully settled, then un-hides in one go. If
  // it un-hid partway, the spring's overshoot would carry the flying cover PAST the card and briefly
  // expose the base cover underneath (the "I can see it under the bounce" artifact). The list can't
  // be scrolled during the dismiss: the flying cover targets the card's captured screen rect, and a
  // root overlay can't cheaply follow the list as it scrolls, so scrolling would land the cover on a
  // stale position. Keeping the (short, bouncy) morph blocking avoids that.
  const finishClose = useCallback(() => {
    req.onClose?.(); // un-hide the source card (cover + title) now that the cover has landed on it
    closeSeriesCardMenu();
  }, [req]);
  const dismiss = useCallback(() => {
    // The open spring, reversed and quickened (see CLOSE_SPRING) — the cover morphs back onto the card
    // the same bouncy way it came out, just without the long tail that kept the list locked.
    progress.value = withSpring(0, CLOSE_SPRING, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [progress, finishClose]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [dismiss]);

  // ── Chrome band ───────────────────────────────────────────────────────────
  // The app's bars are chrome the grids scroll UNDER (see bar-surface / app-tabs), so a card at either
  // end of the screen is partly hidden behind one. The lifted cover has to respect that: it's clipped
  // to the band BETWEEN the bars, so it slides out from under the chrome rather than popping over it.
  // Actually drawing it beneath them isn't possible — the bars live deep inside the navigator while
  // this is a root overlay, and z-order is a total order: the backdrop must cover the bars, the cover
  // must be over the backdrop. Clipping is how the cover ends up behind the bars anyway.
  //
  // Both bars slide away on scroll, so what's on screen at press time is what clips — hence the live
  // stores rather than constants. The band also bounds the panel + menu below, so the RESTING cover is
  // always inside it (a popup that reached into the top bar would clip its own cover).
  const chromeTop = Math.max(0, insets.top + useTopBarHeight() - getTopBarHidden());
  const tabBarH = BottomTabInset + insets.bottom;
  const hasTabBar = !useIsLargeScreen() && TAB_ROUTES.has(pathname);
  const tabBarShown = hasTabBar ? Math.max(0, tabBarH - NATIVE_HIDE_OFFSET * getTabBarProgress()) : 0;
  const chromeBottom = winH - tabBarShown;

  // ── Geometry ──────────────────────────────────────────────────────────────
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const topLimit = chromeTop + EDGE_PAD;
  const bottomLimit = chromeBottom - EDGE_PAD;
  const cardCenterX = rect.x + rect.width / 2;

  const panelW = Math.min(winW - EDGE_PAD * 2, PANEL_MAX_WIDTH);
  const panelLeft = clamp(cardCenterX - panelW / 2, EDGE_PAD, winW - panelW - EDGE_PAD);

  const menuW = Math.min(MENU_WIDTH, winW - EDGE_PAD * 2);
  const menuH = ROW_HEIGHT * MENU_ROWS + StyleSheet.hairlineWidth * (MENU_ROWS - 1) + MENU_PAD_V * 2;
  const menuLeft = clamp(cardCenterX - menuW / 2, EDGE_PAD, winW - menuW - EDGE_PAD);

  const coverH = COVER_W / clampThumbAspect(coverAspect ?? DEFAULT_THUMB_ASPECT);

  // Real panel height once measured (estimate before then). The menu always sits BELOW the panel.
  const [panelH, setPanelH] = useState<number | null>(null);
  const effPanelH = panelH ?? PANEL_HEIGHT_ESTIMATE;

  // Gate the resize spring so it only animates CONTENT-driven size changes (a skeleton swapping for
  // real content), not the one-time correction from the rough estimate to the first measured height —
  // otherwise the menu would spring down from its estimate placement on every open. Turns on a render
  // after the first measurement, so that first correction snaps into place un-animated (it lands
  // before the morph is visible anyway).
  const [resizeReady, setResizeReady] = useState(false);
  useEffect(() => {
    if (panelH != null && !resizeReady) setResizeReady(true);
  }, [panelH, resizeReady]);
  const resize = resizeReady ? RESIZE : undefined;

  const groupH = effPanelH + GAP + menuH;
  const available = bottomLimit - topLimit;
  const panelTop = groupH <= available ? clamp(rect.y, topLimit, bottomLimit - groupH) : topLimit;
  const menuTop = panelTop + effPanelH + GAP;

  // Shared-element FLIP for the COVER only: it travels from the pressed card's cover (scaled to the
  // card's width) to its resting SLOT — a top corner of the panel's top row. Same width/height at rest
  // (both use coverAspect), and the radius is counter-scaled so the visual corner stays a constant 10px.
  //
  // The slot goes on whichever side (left/right) is nearer the pressed card, so the morph travels the
  // shortest distance — a card near the right edge lifts into a right-anchored cover instead of flying
  // across the panel.
  const leftSlotX = panelLeft + PANEL_PAD;
  const rightSlotX = panelLeft + panelW - PANEL_PAD - COVER_W;
  const coverOnRight = Math.abs(rect.x - rightSlotX) < Math.abs(rect.x - leftSlotX);
  const coverSlotX = coverOnRight ? rightSlotX : leftSlotX;
  const coverSlotY = panelTop + PANEL_PAD;
  const fromScale = rect.width / COVER_W;

  // ── Live geometry ─────────────────────────────────────────────────────────
  // Every position above can CHANGE while the morph is already playing: the card's measured rect
  // arrives a frame or two after the finger-point estimate the menu opens with (see
  // `series-card-menu.tsx`), and the panel grows when the detail query swaps skeletons for real
  // content, which pushes `panelTop` (and with it the cover's slot) up on a low card. Feeding those
  // straight into `left`/`top` teleported the panel and the flying cover mid-flight — the first-press
  // jump, invisible on a re-press only because the cached query + warm JS thread land the corrections
  // on frame 0.
  //
  // So the panel/menu/cover are laid out at the origin and positioned purely by transform, from shared
  // values that SPRING to a new target once the popup is up. A correction now continues the animation
  // from wherever it is instead of cutting to the new trajectory. Before the first measurement they're
  // written straight (same gate as `resize`), so opening is still a clean single motion.
  const panelPos = { x: useSharedValue(panelLeft), y: useSharedValue(panelTop) };
  const menuPos = { x: useSharedValue(menuLeft), y: useSharedValue(menuTop) };
  const coverTo = { x: useSharedValue(coverSlotX), y: useSharedValue(coverSlotY) };
  const coverFrom = { x: useSharedValue(rect.x), y: useSharedValue(rect.y), scale: useSharedValue(fromScale) };

  // Compared against the last TARGET written, not `sv.value` — that reads the animating value, so a
  // re-render mid-spring would look like a change and restart the spring (killing its momentum).
  const targets = useRef<Record<string, number>>({});
  useEffect(() => {
    const put = (key: string, sv: SharedValue<number>, v: number) => {
      if (targets.current[key] === v) return;
      const first = targets.current[key] === undefined;
      targets.current[key] = v;
      sv.value = resizeReady && !first ? withSpring(v, MORPH_SPRING) : v;
    };
    put('panelX', panelPos.x, panelLeft);
    put('panelY', panelPos.y, panelTop);
    put('menuX', menuPos.x, menuLeft);
    put('menuY', menuPos.y, menuTop);
    put('coverToX', coverTo.x, coverSlotX);
    put('coverToY', coverTo.y, coverSlotY);
    put('coverFromX', coverFrom.x, rect.x);
    put('coverFromY', coverFrom.y, rect.y);
    put('coverFromScale', coverFrom.scale, fromScale);
  });

  const backdropBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 0.3, 1], [0, 0, BACKDROP_BLUR]),
  }));
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 0, BACKDROP_TINT_OPACITY]),
  }));
  // The panel background + content just FADE in at their final position (no movement of their own —
  // the transform only carries the panel's live position).
  const panelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4, 1], [0, 0, 1]),
    transform: [{ translateX: panelPos.x.value }, { translateY: panelPos.y.value }],
  }));
  // The cover morphs from the card; stays opaque (the source card is hidden behind it). Both ends of
  // the FLIP are live, so a corrected card rect or a shifted slot bends the path instead of cutting it.
  // Y is offset by the clip band's origin, since the cover is laid out inside it (see `coverClip`).
  const coverStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [coverFrom.x.value, coverTo.x.value]) },
      { translateY: interpolate(progress.value, [0, 1], [coverFrom.y.value, coverTo.y.value]) - chromeTop },
      { scale: interpolate(progress.value, [0, 1], [coverFrom.scale.value, 1]) },
    ],
    shadowOpacity: progress.value * 0.28,
  }));
  const coverRadiusStyle = useAnimatedStyle(() => {
    const s = coverFrom.scale.value;
    return { borderRadius: 10 / (s + (1 - s) * progress.value) };
  });
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateX: menuPos.x.value },
      { translateY: menuPos.y.value + interpolate(progress.value, [0, 1], [-10, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.9, 1]) },
    ],
  }));

  const metaLine = buildMetaLine(detail.data?.meta, detail.data?.chapterCount, direct);

  const act = (toggle: () => void) => {
    toggle();
    dismiss();
  };

  // Tapping a tag opens Search on a matching query/filter — the same shared intent as the Series
  // screen's tag chips (see tagSearchIntent). Close instantly, then hand the intent over.
  //
  // Only PUSH `/search` when we aren't already there. This menu is a root overlay, so it also opens
  // over cards in Search's OWN results grid; pushing from there would stack a second Search screen on
  // the first. When Search is already the open screen, setting the intent is enough — it consumes it
  // through `subscribeSearchIntent` and refines in place (dismissing this overlay changes no route,
  // so there's no remount to consume it on).
  const onTagPress = useCallback(
    (group: TagGroup, index: number) => {
      const intent = tagSearchIntent(group, index, { bridgeName: bridge ?? '' });
      if (!intent) return;
      setSearchIntent(intent);
      req.onClose?.();
      closeSeriesCardMenu();
      if (pathname !== '/search') router.push('/search');
    },
    [bridge, req, router, pathname],
  );

  // Tapping a page thumbnail opens the reader there. Close instantly (un-hide the card + drop the
  // host so the pushed reader isn't left under it) rather than playing the morph-back.
  const openReaderAt = useCallback(
    (pageIndex: number) => {
      req.onClose?.();
      closeSeriesCardMenu();
      router.push({
        pathname: '/reader',
        params: { seed: entry.id, title: entry.title, direct: '1', start: String(pageIndex), ...(bridgeId ? { bridgeId } : {}) },
      });
    },
    [req, router, entry.id, entry.title, bridgeId],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Blurred, tap-to-dismiss backdrop. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss}>
        <AnimatedBlurView tint="dark" experimentalBlurMethod={ANDROID_BLUR} animatedProps={backdropBlurProps} style={StyleSheet.absoluteFill} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdropTint, backdropTintStyle]} />
      </Pressable>

      {/* Panel background + content — fades in at the final position. `box-none` so taps fall through
          to the dismiss backdrop while the page rail's FlatList still receives touches. The cover slot
          is a transparent placeholder; the real cover is the morphing layer below. */}
      <Animated.View
        pointerEvents="box-none"
        onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
        style={[styles.panelWrap, { width: panelW }, panelStyle]}>
        <Animated.View layout={resize} style={[styles.panel, { backgroundColor: theme.backgroundPanel }]}>
          <View style={[styles.topRow, coverOnRight && styles.topRowReverse]}>
            <View style={[styles.coverSlot, { width: COVER_W, height: coverH }]} />
            <View style={styles.info}>
              <ThemedText style={styles.title} numberOfLines={3}>
                {entry.title}
              </ThemedText>
              {/* Fixed-height slots (reserved in both states) so the panel doesn't jump when the real
                  meta/description replace their skeletons. */}
              <View style={styles.metaSlot}>
                {detailLoaded ? (
                  metaLine ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {metaLine}
                    </ThemedText>
                  ) : null
                ) : (
                  <Skeleton style={styles.metaSkeleton} />
                )}
              </View>
              <View style={styles.descSlot}>
                {detailLoaded ? (
                  detail.data?.description ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={DESC_LINES}>
                      {detail.data.description}
                    </ThemedText>
                  ) : null
                ) : (
                  <View style={styles.descSkeleton}>
                    <Skeleton style={styles.descLine} />
                    <Skeleton style={styles.descLine} />
                    <Skeleton style={[styles.descLine, styles.descLineShort]} />
                  </View>
                )}
              </View>
            </View>
          </View>
          {detailLoaded ? (
            detail.data?.genres?.length || detail.data?.tagGroups?.length ? (
              <View style={styles.tags}>
                {detail.data.genres?.length ? <ChipRow horizontal contentInset={PANEL_PAD} labels={detail.data.genres} /> : null}
                {/* Keyed by index, not `g.label` — a bridge can repeat a group label (see chipKey). */}
                {detail.data.tagGroups?.map((g, gi) => (
                  <TagGroupRow
                    key={`${gi}:${g.label}`}
                    group={g}
                    horizontal
                    contentInset={PANEL_PAD}
                    onTagPress={(i) => onTagPress(g, i)}
                  />
                ))}
              </View>
            ) : null
          ) : (
            <TagsSkeleton />
          )}
          {direct ? (
            <PageRail thumbs={pageList.data?.pageThumbs} loading={pageList.isLoading} bridgeId={bridgeId} seed={entry.id} onOpenPage={openReaderAt} />
          ) : null}
        </Animated.View>
      </Animated.View>

      {/* The cover — morphs out of the card, on top of the (fading-in) panel, clipped to the band
          between the bars so it emerges from under the chrome instead of over it (see "Chrome band"). */}
      <View pointerEvents="none" style={[styles.coverClip, { top: chromeTop, height: chromeBottom - chromeTop }]}>
        <Animated.View pointerEvents="none" style={[styles.coverLayer, { width: COVER_W, height: coverH }, coverStyle]}>
          <Animated.View style={[styles.coverInner, coverRadiusStyle]}>
            {entry.cover ? (
              <Image source={{ uri: entry.cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            ) : null}
          </Animated.View>
        </Animated.View>
      </View>

      {/* The actions menu — a frosted (blurred) panel. Its position springs (see `menuPos`) so it eases
          down when the panel grows on late content instead of jumping to the new spot below it. */}
      <Animated.View style={[styles.menuWrap, { width: menuW }, menuStyle]}>
        <BlurView tint={menuTint} intensity={MENU_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={[styles.menu, { borderColor: theme.backgroundSelected }]}>
          {/* Read is the one real ACTION here (the others toggle state), so it's the only row that
              carries the accent — and it leads, the way a context menu's primary item does. */}
          <MenuRow
            label={reading.label}
            Icon={PlayIcon}
            loading={false}
            primary
            onPress={() => {
              req.onClose?.(); // un-hide the card and drop the overlay — the reader is about to cover it
              closeSeriesCardMenu();
              reading.start();
            }}
          />
          <View style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />
          <MenuRow
            label={inLibrary ? 'Remove from Library' : 'Add to Library'}
            Icon={inLibrary ? CheckIcon : PlusIcon}
            loading={inLibrary === null}
            active={!!inLibrary}
            onPress={() => act(toggleLibrary)}
          />
          <View style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />
          <MenuRow
            label={favorited ? 'Unfavorite' : 'Favorite'}
            Icon={StarIcon}
            iconFilled={!!favorited}
            loading={favorited === null}
            active={!!favorited}
            onPress={() => act(toggleFavorite)}
          />
        </BlurView>
      </Animated.View>
    </View>
  );
}

/** A single line summarizing the series — author · type · status, plus a chapter/page count. */
function buildMetaLine(
  meta: { label: string; value: string }[] | undefined,
  chapterCount: number | undefined,
  direct: boolean | undefined,
): string {
  const pick = (label: string) => meta?.find((m) => m.label === label)?.value;
  const parts = [pick('AUTHOR'), pick('TYPE'), pick('STATUS')].filter(Boolean) as string[];
  if (chapterCount != null) parts.push(`${chapterCount} ${direct ? 'pages' : 'chapters'}`);
  return parts.join('  ·  ');
}

type RailCell = { thumb: PageThumbSource | null; index: number };

/** Horizontal, VIRTUALIZED + lazy rail of a direct series' page thumbnails: the FlatList only mounts
 *  the visible tiles, and each `PageThumb` lazily fetches its own thumbnail when it isn't inlined. */
function PageRail({
  thumbs,
  loading,
  bridgeId,
  seed,
  onOpenPage,
}: {
  thumbs: (PageThumbSource | null)[] | undefined;
  loading: boolean;
  bridgeId?: string;
  seed: string;
  onOpenPage: (pageIndex: number) => void;
}) {
  if (loading) return <RailSkeleton />;
  if (!thumbs || thumbs.length === 0) return null;
  // Wrap in objects so `null` thumbs never appear as raw list data (a null entry ends LegendList's
  // virtualization). The inter-tile gap lives as a per-item marginRight, since LegendList positions
  // items virtually and ignores a contentContainerStyle gap.
  const data: RailCell[] = thumbs.map((thumb, index) => ({ thumb, index }));
  return (
    <LegendList
      horizontal
      data={data}
      keyExtractor={(it) => String(it.index)}
      recycleItems
      estimatedItemSize={RAIL_THUMB_H * DEFAULT_THUMB_ASPECT + RAIL_GAP}
      showsHorizontalScrollIndicator={false}
      style={styles.railList}
      contentContainerStyle={styles.rail}
      renderItem={({ item }) => (
        <View style={styles.railItem}>
          <PageThumb
            thumb={item.thumb}
            index={item.index}
            seed={seed}
            bridgeId={bridgeId}
            page={item.index + 1}
            width={RAIL_THUMB_W}
            slotHeight={RAIL_THUMB_H}
            showPageNumber={false}
            onPress={() => onOpenPage(item.index)}
          />
        </View>
      )}
    />
  );
}

// ── Loading skeletons ────────────────────────────────────────────────────────
// Shown while `detail` / `pageList` fetch, so the panel opens at roughly its final size (title is
// already known synchronously) and the swap to real content is a small, animated size change rather
// than a jarring pop-in. Shapes mirror the real elements: a meta line, a few description lines, a
// remembered number of tag rows (`lastTagRowCount`), and a rail of page-sized tiles.

const SKELETON_CHIP_WIDTHS = [56, 44, 72, 38, 60, 50];
const RAIL_SKELETON_W = Math.round(RAIL_THUMB_H * DEFAULT_THUMB_ASPECT);

/** `lastTagRowCount` full-bleed rows of pill placeholders (offset per row so they don't look like a grid). */
function TagsSkeleton() {
  return (
    <View style={styles.tags}>
      {Array.from({ length: lastTagRowCount }).map((_, row) => (
        <View key={row} style={styles.tagRowSkeleton}>
          {SKELETON_CHIP_WIDTHS.slice(row % 2, row % 2 + 5).map((w, i) => (
            <Skeleton key={i} style={[styles.chipSkeleton, { width: w }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** A short run of page-sized tiles filling the rail's height. */
function RailSkeleton() {
  return (
    <View style={styles.railSkeleton}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} style={styles.railSkeletonTile} />
      ))}
    </View>
  );
}

/**
 * One row of the actions menu.
 *
 * Colour means ACTION here, not state: only the `primary` row (Read) is tinted with the accent. The
 * toggles say what they are through their icon — a checkmark once in the library, a filled star once
 * favourited — and keep the plain label colour whether they're on or off. Painting an on-state row
 * blue made "in Library" shout louder than the one thing you'd actually come here to do, and the
 * accent was carrying two meanings at once ("this is tappable" and "this is on").
 */
function MenuRow({
  label,
  Icon,
  iconFilled,
  loading,
  active,
  primary,
  onPress,
}: {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** Fill the glyph rather than tint it — how an "on" toggle reads (see above). */
  iconFilled?: boolean;
  loading: boolean;
  active?: boolean;
  /** The menu's one real action: accent-tinted, and the row people reach for first. */
  primary?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = loading ? theme.textSecondary : primary ? theme.accent : theme.text;
  // An off toggle's glyph sits back a little, so the on-state (solid glyph, full contrast) reads as
  // a change without needing a colour of its own.
  const iconColor = loading ? theme.textSecondary : primary || active ? color : theme.textSecondary;
  return (
    <Pressable
      onPress={loading ? undefined : onPress}
      disabled={loading}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText style={[styles.rowLabel, { color }]} numberOfLines={1}>
        {label}
      </ThemedText>
      <Icon color={iconColor} size={19} filled={iconFilled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdropTint: {
    backgroundColor: '#000000',
  },
  // The panel, cover and menu are all laid out at the overlay's origin and placed by an animated
  // translate (see "Live geometry") — never by `left`/`top`, which can't animate a late correction.
  panelWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  panel: {
    borderRadius: 16,
    // Only vertical padding: the horizontal scrollers (tags, page rail) bleed to the panel's rounded
    // edges (clipped by `overflow: hidden`) so their content isn't cut off at an inset viewport; they
    // carry their own leading inset (`PANEL_PAD`) instead. The top row re-adds horizontal padding.
    paddingVertical: PANEL_PAD,
    gap: Spacing.three,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: PANEL_PAD,
  },
  // Cover on the right (nearer a right-edge card): swap the row so the cover slot lands on that side.
  topRowReverse: {
    flexDirection: 'row-reverse',
  },
  coverSlot: {
    // A purely transparent spacer that reserves the cover's resting spot in the row (so the title
    // column doesn't shift). No fill/radius: a visible placeholder here would read as a second shape
    // sitting under the cover as it morphs over from the card.
    backgroundColor: 'transparent',
  },
  info: {
    flex: 1,
    gap: Spacing.one,
  },
  title: {
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 21,
  },
  metaSlot: {
    height: META_H,
    justifyContent: 'center',
  },
  descSlot: {
    height: DESC_H,
  },
  tags: {
    gap: Spacing.two,
  },
  // Full-bleed horizontally; vertically it spans only the gap between the bars, and clips the cover to
  // it. Transparent and non-interactive — it exists purely as the clip boundary.
  coverClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  coverLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    // Scale/translate about the top-left, so the translate IS the cover's on-screen top-left corner
    // and the FLIP starts exactly on the card's cover.
    transformOrigin: '0% 0%',
    shadowColor: '#000000',
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  coverInner: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.2)',
  },
  // The list is exactly one tile tall, so no stray vertical padding pushes the tile past the viewport
  // and clips its bottom edge (the panel's own `gap` already spaces the rail from the tags above).
  railList: {
    height: RAIL_THUMB_H,
  },
  rail: {
    // Leading inset so the first tile rests off the panel edge, while the list viewport itself spans
    // full-bleed (content scrolls all the way to the rounded edge instead of clipping at an inset).
    paddingLeft: PANEL_PAD,
  },
  railItem: {
    // Fixed height; width follows each page's real aspect (PageThumb `slotHeight` mode). No bg/clip —
    // the tile rounds and clips itself.
    height: RAIL_THUMB_H,
    marginRight: RAIL_GAP,
  },
  metaSkeleton: {
    height: 12,
    width: '70%',
    borderRadius: 4,
  },
  descSkeleton: {
    gap: 6,
  },
  descLine: {
    height: 12,
    borderRadius: 4,
  },
  descLineShort: {
    width: '55%',
  },
  tagRowSkeleton: {
    flexDirection: 'row',
    gap: Spacing.one,
    paddingLeft: PANEL_PAD,
  },
  chipSkeleton: {
    height: 24,
    borderRadius: 999,
  },
  railSkeleton: {
    flexDirection: 'row',
    gap: RAIL_GAP,
    height: RAIL_THUMB_H,
    paddingLeft: PANEL_PAD,
    overflow: 'hidden',
  },
  railSkeletonTile: {
    height: RAIL_THUMB_H,
    width: RAIL_SKELETON_W,
    borderRadius: 8,
  },
  menuWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  menu: {
    borderRadius: 14,
    paddingVertical: MENU_PAD_V,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: ROW_HEIGHT,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.four,
  },
});
