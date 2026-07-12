import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { interpolate, LinearTransition, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';

import { ChipRow, TagGroupRow } from '@/components/chip';
import { CheckIcon, PlusIcon, StarIcon, type IconProps } from '@/components/icons/ui-icons';
import { PageThumb } from '@/components/series/chapters-section';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { setBrowseIntent, tagBrowseIntent } from '@/data/browse-intent';
import type { TagGroup } from '@/data/mock';
import { seriesDetailQuery, seriesListQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { PageThumbSource } from '@/data/types';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { closeSeriesCardMenu, useSeriesCardMenu, type SeriesCardMenuRequest } from '@/lib/series-card-menu';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
// The one spring used everywhere: the open morph, the reversed close morph, and the panel/menu
// resize — so every motion in the popup shares the same bouncy feel.
const MORPH_SPRING = { damping: 16, stiffness: 170, mass: 0.8 } as const;
// How the panel + menu resize/reposition when late content lands — the panel is a plain Animated.View
// (not the ThemedView, which doesn't forward a ref) so its height can spring when async content swaps
// a skeleton for the real thing, instead of the panel popping to its final size.
const RESIZE = LinearTransition.springify().damping(MORPH_SPRING.damping).stiffness(MORPH_SPRING.stiffness).mass(MORPH_SPRING.mass);

// Last-seen count of tag rows (genres row + one per tag group), remembered across opens so the
// loading skeleton can show a plausible number of rows instead of a fixed guess. A plain module
// global: it's a cheap heuristic for the placeholder shape, not state anything renders off directly.
let lastTagRowCount = 2;

const EDGE_PAD = 12; // keep the whole thing off the screen edges
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
  const pageList = useQuery(seriesListQuery(ds, mock, bridgeId ?? '', entry.id, !!direct, !!direct && !!bridgeId));
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
    // The open spring, reversed — the cover morphs back onto the card the same bouncy way it came out.
    progress.value = withSpring(0, MORPH_SPRING, (finished) => {
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

  // ── Geometry ──────────────────────────────────────────────────────────────
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const topLimit = insets.top + EDGE_PAD;
  const bottomLimit = winH - insets.bottom - EDGE_PAD;
  const cardCenterX = rect.x + rect.width / 2;

  const panelW = Math.min(winW - EDGE_PAD * 2, PANEL_MAX_WIDTH);
  const panelLeft = clamp(cardCenterX - panelW / 2, EDGE_PAD, winW - panelW - EDGE_PAD);

  const menuW = Math.min(MENU_WIDTH, winW - EDGE_PAD * 2);
  const menuH = ROW_HEIGHT * 2 + MENU_PAD_V * 2;
  const menuLeft = clamp(cardCenterX - menuW / 2, EDGE_PAD, winW - menuW - EDGE_PAD);

  const coverH = COVER_W / clampThumbAspect(coverAspect ?? DEFAULT_THUMB_ASPECT);

  // Real panel height once measured (estimate before then). The menu always sits BELOW the panel.
  const [panelH, setPanelH] = useState<number | null>(null);
  const effPanelH = panelH ?? PANEL_HEIGHT_ESTIMATE;

  // Gate the resize spring so it only animates CONTENT-driven size changes (a skeleton swapping for
  // real content), not the one-time correction from the rough estimate to the first measured height —
  // otherwise the menu would spring down from its estimate placement on every open. Turns on a render
  // after the first measurement, so that first correction snaps into place un-animated.
  const [resizeReady, setResizeReady] = useState(false);
  useEffect(() => {
    if (panelH != null && !resizeReady) setResizeReady(true);
  }, [panelH, resizeReady]);
  const resize = resizeReady ? RESIZE : undefined;

  const groupH = effPanelH + GAP + menuH;
  const available = bottomLimit - topLimit;
  const panelTop = groupH <= available ? clamp(rect.y, topLimit, bottomLimit - groupH) : topLimit;
  const menuTop = panelTop + effPanelH + GAP;

  // Shared-element FLIP for the COVER only: it's laid out at its final slot (a top corner of the
  // panel's top row) but animates FROM the pressed card's cover — scaled to the card's width and
  // translated onto it, then eased to identity. Same width/height (both use coverAspect), and the
  // radius is counter-scaled so the visual corner stays a constant 10px.
  //
  // The slot goes on whichever side (left/right) is nearer the pressed card, so the morph travels the
  // shortest distance — a card near the right edge lifts into a right-anchored cover instead of flying
  // across the panel. Pure open-time geometry (from the card's rect); no per-frame cost.
  const leftSlotX = panelLeft + PANEL_PAD;
  const rightSlotX = panelLeft + panelW - PANEL_PAD - COVER_W;
  const coverOnRight = Math.abs(rect.x - rightSlotX) < Math.abs(rect.x - leftSlotX);
  const coverSlotX = coverOnRight ? rightSlotX : leftSlotX;
  const coverSlotY = panelTop + PANEL_PAD;
  const fromScale = rect.width / COVER_W;
  const coverDx = rect.x - coverSlotX;
  const coverDy = rect.y - coverSlotY;

  const backdropBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 0.3, 1], [0, 0, BACKDROP_BLUR]),
  }));
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 0, BACKDROP_TINT_OPACITY]),
  }));
  // The panel background + content just FADE in at their final position (no movement).
  const panelStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.4, 1], [0, 0, 1]) }));
  // The cover morphs from the card; stays opaque (the source card is hidden behind it).
  const coverStyle = useAnimatedStyle(
    () => ({
      transform: [
        { translateX: interpolate(progress.value, [0, 1], [coverDx, 0]) },
        { translateY: interpolate(progress.value, [0, 1], [coverDy, 0]) },
        { scale: interpolate(progress.value, [0, 1], [fromScale, 1]) },
      ],
      shadowOpacity: progress.value * 0.28,
    }),
    [coverDx, coverDy, fromScale],
  );
  const coverRadiusStyle = useAnimatedStyle(
    () => ({ borderRadius: 10 / (fromScale + (1 - fromScale) * progress.value) }),
    [fromScale],
  );
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-10, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.9, 1]) },
    ],
  }));

  const metaLine = buildMetaLine(detail.data?.meta, detail.data?.chapterCount, direct);

  const act = (toggle: () => void) => {
    toggle();
    dismiss();
  };

  // Tapping a tag drops Browse into a matching search — same shared intent + navigation as the
  // Series screen's tag chips (see tagBrowseIntent). Close instantly and jump to Browse.
  const onTagPress = useCallback(
    (group: TagGroup, index: number) => {
      const intent = tagBrowseIntent(group, index, { bridgeName: bridge ?? '' });
      if (!intent) return;
      setBrowseIntent(intent);
      req.onClose?.();
      closeSeriesCardMenu();
      router.dismissTo('/');
    },
    [bridge, req, router],
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
        style={[styles.panelWrap, { left: panelLeft, top: panelTop, width: panelW }, panelStyle]}>
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
                {detail.data.tagGroups?.map((g) => (
                  <TagGroupRow key={g.label} group={g} horizontal contentInset={PANEL_PAD} onTagPress={(i) => onTagPress(g, i)} />
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

      {/* The cover — morphs out of the card, on top of the (fading-in) panel. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.coverLayer, { left: coverSlotX, top: coverSlotY, width: COVER_W, height: coverH }, coverStyle]}>
        <Animated.View style={[styles.coverInner, coverRadiusStyle]}>
          {entry.cover ? (
            <Image source={{ uri: entry.cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          ) : null}
        </Animated.View>
      </Animated.View>

      {/* The actions menu — a frosted (blurred) panel. `layout` so it eases down when the panel grows
          (late content) instead of jumping to the new position below it. */}
      <Animated.View layout={resize} style={[styles.menuWrap, { left: menuLeft, top: menuTop, width: menuW }, menuStyle]}>
        <BlurView tint={menuTint} intensity={MENU_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={[styles.menu, { borderColor: theme.backgroundSelected }]}>
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

function MenuRow({
  label,
  Icon,
  loading,
  active,
  onPress,
}: {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  loading: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = loading ? theme.textSecondary : active ? theme.accent : theme.text;
  return (
    <Pressable
      onPress={loading ? undefined : onPress}
      disabled={loading}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText style={[styles.rowLabel, { color }]} numberOfLines={1}>
        {label}
      </ThemedText>
      <Icon color={color} size={19} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdropTint: {
    backgroundColor: '#000000',
  },
  panelWrap: {
    position: 'absolute',
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
  coverLayer: {
    position: 'absolute',
    // Scale/translate about the top-left so the FLIP starts exactly on the card's cover.
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
