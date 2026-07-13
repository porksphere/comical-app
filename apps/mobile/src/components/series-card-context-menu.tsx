import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';

import { NATIVE_HIDE_OFFSET } from '@/components/app-tabs';
import { TagStrip } from '@/components/chip';
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
import {
  closeSeriesCardMenu,
  commitHoveredRow,
  holdActive,
  holdArmed,
  holdX,
  holdY,
  hoveredRow,
  openSeriesCardMenu,
  setMenuRowActions,
  useSeriesCardMenu,
  type SeriesCardMenuRequest,
} from '@/lib/series-card-menu';
import { getTabBarProgress } from '@/lib/tab-bar-visibility';
import { getTopBarHidden } from '@/lib/top-bar-visibility';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
/** The tick as the held finger moves between rows — what gives the iOS menu its detents. */
function selectionTick(): void {
  void Haptics.selectionAsync();
}
// Every motion in this popup is a spring, and they're all tuned around the same two numbers, because
// those are the two things you actually feel:
//
//   damping ratio  ζ = damping / (2·√(stiffness·mass))  — how much it OVERSHOOTS. Below 1 it bounces;
//                                                          around 0.5 it bounces visibly and settles.
//   decay rate         damping / (2·mass)               — how fast it DIES OUT. Independent of
//                                                          stiffness, which is the non-obvious part:
//                                                          you make a spring quicker without making it
//                                                          stiffer-feeling by raising damping AND
//                                                          stiffness together.
//
// The MORPH — the cover popping out of the card and back — is deliberately unhurried. Don't speed it
// up: it was quickened once (in the name of "springier") and the pop became a snap, which reads as
// cheap. The lift is the moment the whole interaction is built around; let it take its time.
const MORPH_SPRING = { damping: 16, stiffness: 170, mass: 0.8 } as const;
// The close is the same spring, roughly twice as fast: the overlay swallows touches until it unmounts,
// so every millisecond of the return is time the list underneath can't be scrolled. Damping and
// stiffness are raised TOGETHER, which keeps the damping ratio (the size of the overshoot — the
// springy part) while doubling the decay rate, and decay is what actually sets how long it lingers.
const CLOSE_SPRING = { damping: 28, stiffness: 660, mass: 0.7 } as const;
// ── How the resize FOLLOWS the finger ────────────────────────────────────────
// The panel does NOT track your thumb 1:1. The pan writes a TARGET and the panel chases it with a
// time-based lerp, so it always runs a little behind and eases into place — including while your
// finger is still down. Welding it to the finger is what made this feel linear and cheap: the panel
// arrived exactly when the thumb did, with no weight to it, and every frame of the movement was a
// straight line. Lagging behind is what makes a big object feel like a big object.
//
// Time-based, not per-frame: the smoothing has to be a function of elapsed time or it changes
// character with the frame rate (a dropped frame would visibly jump).
const FOLLOW_TAU = 0.13; // seconds to close ~63% of the remaining distance
// And the drag is GEARED DOWN: a full sweep of the range takes about twice the finger travel it used
// to. 1:1 with the panel's own edge sounded principled and felt frantic — the range is only a couple
// of hundred pixels, so a normal flick crossed all of it instantly.
const DRAG_GAIN = 0.5;
// How far into the morph the cover stops being clipped to the chrome band. Early: the band exists to
// hide the cover while it's lifting out from under the bars, and by a quarter of the way up it has
// cleared them. Late enough that the switch is invisible, early enough that the RESTING cover — which
// can sit right over the top bar once the panel rides up to make room for the menu — is never cut.
const CLIP_UNTIL = 0.25;

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
const MENU_PAD_V = Spacing.one;
// Read + Add to Library + Favorite. Keep in step with the rows rendered below — the menu's height is
// computed from this (it's what the panel's resize range budgets for), not measured.
const MENU_ROWS = 3;
// DEV ONLY: pad the menu out with dummy rows, to exercise the case the pan gesture exists for — a
// group too tall for the screen, where the panel has to give up height for the menu to be reachable.
//
// It DISTORTS THE LAYOUT while it's on, and that isn't a bug in either the rows or the placement: an
// 11-row menu plus a full-size preview genuinely doesn't fit anywhere except near the top of the
// screen, once you also insist that MIN_VISIBLE_ROWS of the menu stay on screen. So while this is
// non-zero, expect every popup to sit high — that's the invariant doing its job, not the placement
// failing. (This is what "the popup is always at the top once I've scrolled" turned out to be.)
// The real three-row menu never comes close to that constraint.
const DEBUG_EXTRA_MENU_ROWS = __DEV__ ? 8 : 0;

// ── Pan / resize ─────────────────────────────────────────────────────────────
// The panel never scales below this, however long the menu gets — a preview shrunk to a postage stamp
// is worse than a menu you have to swipe for.
const MIN_PANEL_SCALE = 0.45;
// Drag DOWN past the top of the resize range (the panel already at full size) and the popup starts
// CLOSING with the finger: this is how far you'd pull to take it all the way back onto the card
// (progress 1 → 0). It reuses the open morph, so a drag-dismiss IS the shared-element animation
// running backwards under your thumb — nothing new to look at, just driven by you instead of a spring.
// DOWN only. Up is how you reach the menu (see RUBBER_RESIST).
const DISMISS_DRAG = 220;
// Release past this much overscroll (or with this much downward velocity) and it dismisses rather than
// settling back — the usual "did they mean it" test, deliberately forgiving.
const DISMISS_RELEASE_PX = 64;
const DISMISS_RELEASE_VELOCITY = 900;
// Pulling UP past the end of the range doesn't dismiss — it rubber-bands. Reaching for the menu is a
// swipe UP, and reaching for the menu must never throw the popup away.
//
// It has to GIVE, though, and visibly. The first values here barely moved (a quarter of the pull,
// capped at 6% of the range), so once the menu was fully up, swiping up on it did essentially nothing —
// which doesn't read as "you're at the end", it reads as the app having stopped responding to you.
const RUBBER_RESIST = 0.35; // how much of the extra pull actually moves anything
const RUBBER_LIMIT = 0.1; // and how far it can go, in range units
// How far ahead a fling is projected when deciding which end of the range to spring to.
const FLING_PROJECTION = 0.12; // seconds
// How many menu rows must be on screen when the popup opens. Below this it stops reading as a menu —
// you'd long-press a card in the bottom row and get a preview with its actions hidden under the fold.
const MIN_VISIBLE_ROWS = 4;
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
// DEV + WEB only: a handle to open this from a browser, where the long-press path doesn't exist (web
// cards use the hover 3-dot affordance instead — see series-card-menu.web.tsx). Without it the popup
// is unreachable outside a device, which makes its gesture behaviour untestable in a browser.
// Stripped from any release build, and from native entirely.
if (__DEV__ && Platform.OS === 'web') {
  const g = globalThis as Record<string, unknown>;
  g.__openSeriesCardMenu = openSeriesCardMenu;
  // The peek-and-commit channel, so the hit-test/highlight/commit can be driven from a browser too.
  // On web the CARD never writes these (web cards use the 3-dot affordance and never long-press), so
  // this is the only way to exercise them outside a device.
  g.__seriesCardMenuHold = { holdActive, holdArmed, holdX, holdY, hoveredRow, commitHoveredRow };
}

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

  // The PANEL still opens against the left edge — it's near enough the full width of a phone that
  // centring it would move it by a few pixels and buy nothing.
  const panelW = Math.min(winW - EDGE_PAD * 2, PANEL_MAX_WIDTH);
  const panelLeft = EDGE_PAD;

  const menuW = Math.min(MENU_WIDTH, winW - EDGE_PAD * 2);
  const menuRowCount = MENU_ROWS + DEBUG_EXTRA_MENU_ROWS;
  const rowCount = menuRowCount;
  const menuH = ROW_HEIGHT * menuRowCount + MENU_PAD_V * 2;
  // The MENU centres on the card you pressed — as close to it as the screen edges allow. It's much
  // narrower than the panel, so where it sits actually matters: it lands under the thumb that's already
  // there, which is the same reasoning as the placement above (the popup appears where you're looking,
  // not where the layout finds convenient). Clamped, so a card at either edge still gets a menu fully
  // on screen rather than one hanging off it.
  const cardCenterX = rect.x + rect.width / 2;
  const menuLeft = clamp(cardCenterX - menuW / 2, EDGE_PAD, winW - menuW - EDGE_PAD);

  const coverH = COVER_W / clampThumbAspect(coverAspect ?? DEFAULT_THUMB_ASPECT);

  // The panel's NATURAL height — what it would be if nothing constrained it. Measured from the content
  // itself (not the panel, whose height we now drive), so it stays known even while the panel is
  // squeezed below it.
  const [contentH, setContentH] = useState<number | null>(null);
  const naturalPanelH = contentH != null ? contentH + PANEL_PAD * 2 : PANEL_HEIGHT_ESTIMATE;

  // Gate the geometry springs so they only animate CONTENT-driven changes (a skeleton swapping for
  // real content), not the one-time correction from the rough estimate to the first measured height —
  // otherwise everything would spring out of its estimate placement on every open. Turns on a render
  // after the first measurement, so that first correction snaps into place un-animated (it lands
  // before the morph is visible anyway).
  const [resizeReady, setResizeReady] = useState(false);
  useEffect(() => {
    if (contentH != null && !resizeReady) setResizeReady(true);
  }, [contentH, resizeReady]);

  // ── The resize range ──────────────────────────────────────────────────────
  // The panel and the menu are one column, and it doesn't always fit: a rich preview plus a long menu
  // easily overruns the band between the bars, and the menu is what loses — it runs off the bottom
  // where it can't be reached. So the panel is SCALED, and the pan picks a point in the scale range:
  //
  //   expand 1 (the default) → the panel is as large as it can be: full size, or as much of it as the
  //                            band allows. The menu may be below the fold; swipe to bring it up.
  //   expand 0               → the panel is scaled down just enough for the whole menu to fit below it.
  //
  // The whole panel scales — cover, title, tags, rail — rather than the panel keeping its size and
  // clipping its contents. It reads as the preview zooming out to make room, which is the point: you
  // are still looking at the same thing, just smaller, rather than at a cropped piece of it.
  //
  // If the column already fits at full size, the range is empty and the pan has nothing to resize —
  // every drag is then an overscroll, i.e. a drag-to-dismiss. Which is the behaviour you'd want anyway.
  const available = bottomLimit - topLimit;
  // Can't be bigger than 1:1, and can't be taller than the band.
  const maxScale = Math.min(1, available / naturalPanelH);
  // The scale at which the menu fits underneath. Floored, so a very long menu can't shrink the preview
  // into a postage stamp — past that point the menu simply overflows and you swipe for it.
  const fitScale = (available - GAP - menuH) / naturalPanelH;
  const minScale = clamp(fitScale, MIN_PANEL_SCALE, maxScale);
  const scaleRange = Math.max(0, maxScale - minScale);

  // ── Placement ─────────────────────────────────────────────────────────────
  // The panel's TOP is part of the range too, not a fixed anchor. Pinning it to the top of the band
  // meant that at full size the panel and menu were jammed against the top edge with all the slack
  // dumped below — the popup looked shoved up out of the way rather than presented.
  //
  //   expanded  → the panel lands where the COVER BARELY HAS TO MOVE — see below. Not a fixed
  //               fraction of the screen: the preview should appear where the card already was.
  //   collapsed → the panel rides up only as far as it has to for the group (panel + gap + menu) to
  //               land exactly on the bottom limit — i.e. the menu is fully visible and nothing is
  //               wasted, but the panel is no higher than it needs to be.
  //
  // Interpolating between the two means the panel drifts up as you shrink it and back down as you grow
  // it, which is what makes the resize read as one movement rather than a scale plus a jump.
  const panelHAtMax = naturalPanelH * maxScale;
  const panelHAtMin = naturalPanelH * minScale;
  // Where the panel WANTS to open: exactly where the cover it's growing out of already is. Put the
  // panel's cover slot on the card's cover and the shared-element morph has no vertical distance to
  // travel at all — the preview simply blooms in place. Anything else is movement for its own sake, and
  // a fixed fraction of the screen (which this used to be) guarantees it: a card at the bottom of the
  // grid had its cover thrown halfway up the screen just to satisfy the fraction.
  // (PANEL_PAD is the cover slot's offset inside the panel — `coverSlotLocalY` below, which is declared
  // with the rest of the FLIP. Scaled, because the slot moves with the panel.)
  const idealTop = rect.y - PANEL_PAD * maxScale;

  // ONE hard limit, and only one: the panel opens fully sized and fully on screen. That's it.
  //
  // The menu does NOT get a say in where the popup opens. It used to — a "keep MIN_VISIBLE_ROWS on
  // screen" floor — and that floor is what kept dragging the popup up the screen: with the real
  // three-row menu, min(4, 3) is the WHOLE menu, so the floor was quietly demanding that the entire
  // menu fit below the preview, and paying for it with the one thing that actually matters, which is
  // where the cover ends up. The cover's position is the thing you're looking at. The menu is one swipe
  // away.
  //
  // So: aim at zero movement, and move only as far as keeping the panel on screen forces.
  const lowestTop = Math.max(topLimit, bottomLimit - panelHAtMax);
  const topAtMax = clamp(idealTop, topLimit, lowestTop);

  // Where a swipe takes it: far enough up (and small enough) for the whole menu to sit below the panel.
  // Not clamped to the band's top — a menu too long to fit even at MIN_PANEL_SCALE would otherwise
  // leave its last rows unreachable, and the collapsed end IS the end of the range.
  const topAtMin = Math.min(bottomLimit - (panelHAtMin + GAP + menuH), bottomLimit - panelHAtMin);

  // The popup is swipeable if there is anywhere for it to GO — and that's now two different things: it
  // can scale down, and it can travel up. Either one moves the menu into view, so either one counts.
  // (Before, only scaling counted, so a popup that fitted at full size had no resize at all — which
  // meant its menu had to be placed on screen at open, which is what forced the popup upward. Letting
  // it TRAVEL is what buys the freedom to open where the card is.)
  const topTravel = Math.max(0, topAtMax - topAtMin);
  const dragRange = naturalPanelH * scaleRange + topTravel;
  const expandable = dragRange > 1;

  // A popup with nowhere to go just sits where the card is, clamped on screen.
  const restingTop = topAtMax;
  const panelTopMin = expandable ? topAtMin : restingTop;
  const panelTopMax = expandable ? topAtMax : restingTop;


  // Shared-element FLIP for the COVER only: it travels from the pressed card's cover (scaled to the
  // card's width) to its resting SLOT — a top corner of the panel's top row. The radius is
  // counter-scaled so the visual corner stays a constant 10px however scaled the cover is.
  //
  // The slot goes on whichever side (left/right) is nearer the pressed card, so the morph travels the
  // shortest distance — a card near the right edge lifts into a right-anchored cover instead of flying
  // across the panel.
  //
  // The slot is now given in the PANEL'S OWN coordinates, not the screen's: the panel scales (about its
  // top-left), so the slot's real position is `panelTop/Left + local * scale` and its real size is
  // `COVER_W * scale`. The flying cover has to land on that — a cover that ignored the panel's scale
  // would come to rest floating over a smaller preview.
  const leftSlotLocalX = PANEL_PAD;
  const rightSlotLocalX = panelW - PANEL_PAD - COVER_W;
  const coverOnRight = Math.abs(rect.x - (panelLeft + rightSlotLocalX)) < Math.abs(rect.x - (panelLeft + leftSlotLocalX));
  const coverSlotLocalX = coverOnRight ? rightSlotLocalX : leftSlotLocalX;
  const coverSlotLocalY = PANEL_PAD;
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
  const panelPos = { x: useSharedValue(panelLeft) };
  // The panel's top is interpolated by the SAME `expand` as its scale (see "Placement"), so growing it
  // also walks it down the screen — one movement, not a scale plus a jump.
  const topMin = useSharedValue(panelTopMin);
  const topMax = useSharedValue(panelTopMax);
  const menuPos = { x: useSharedValue(menuLeft) };
  // No `coverTo` pair: the cover's resting slot isn't a fixed point any more, it's wherever the panel's
  // top corner currently is AT the panel's current scale — so it's derived in the worklet instead.
  const coverFrom = { x: useSharedValue(rect.x), y: useSharedValue(rect.y), scale: useSharedValue(fromScale) };
  // The panel's scale range + its natural height, as shared values so the pan can interpolate between
  // them on the UI thread — and so a LATE content change springs the panel (and the menu tracking it)
  // instead of resizing it out from under the finger.
  const minS = useSharedValue(minScale);
  const maxS = useSharedValue(maxScale);
  const naturalH = useSharedValue(naturalPanelH);
  /**
   * Where in the range we are: 1 = the panel as large as it can be, 0 = scaled down far enough for the
   * whole menu to sit below it. Starts at 1 — the popup opens showing you as much of the preview as it
   * can, because that's what you long-pressed for; the menu is one swipe away.
   */
  const expand = useSharedValue(1);
  /**
   * Where the pan WANTS the panel to be. The finger writes this; `expand` chases it (see below), so
   * the panel is never welded to your thumb — it trails it and eases in, which is what gives the
   * movement any weight at all.
   */
  const expandTarget = useSharedValue(1);

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
    put('topMin', topMin, panelTopMin);
    put('topMax', topMax, panelTopMax);
    put('menuX', menuPos.x, menuLeft);
    put('minScale', minS, minScale);
    put('maxScale', maxS, maxScale);
    put('naturalH', naturalH, naturalPanelH);
    put('coverFromX', coverFrom.x, rect.x);
    put('coverFromY', coverFrom.y, rect.y);
    put('coverFromScale', coverFrom.scale, fromScale);
  });

  // NOTE: the panel-height maths is INLINED into each animated style below rather than factored into a
  // shared worklet. `useAnimatedStyle` works out what to subscribe to by looking at the shared values
  // referenced in its own body — hide them inside a helper it calls and it subscribes to nothing, so
  // the style never re-runs and the panel never moves. (Cost me a debugging session; hence the note.)

  // ── The pan ───────────────────────────────────────────────────────────────
  // One vertical drag, anywhere on the screen, doing two things depending on where it is in the range:
  //
  //   inside the range   → SCALE the panel. The column follows the finger like a scroll: drag UP and
  //                        the panel scales down so the menu below rises into view; drag DOWN and it
  //                        scales back up over the menu. The menu is never dragged — it just tracks the
  //                        panel's (scaled) bottom edge.
  //   past either end    → DISMISS. The overscroll feeds `progress` directly, so the popup morphs back
  //                        toward the card under your thumb — the open animation, played backwards by
  //                        your finger rather than by a spring. Let go past a threshold (or with a
  //                        flick) and it finishes closing; let go short of it and it springs back.
  //
  // A column that already fits has an empty range, so EVERY drag on it is an overscroll — i.e. it's
  // simply drag-to-dismiss, which is what you'd want there anyway. No special case needed.
  const panStartExpand = useSharedValue(0);
  const overscroll = useSharedValue(0); // px dragged past an end; sign follows the drag direction
  /**
   * Where the DISMISS pull wants the morph to be, and whether the follower currently owns `progress`.
   *
   * The dismiss drag used to move `progress` directly — the one thing left welded to the finger — so
   * the cover flew back to the card in a dead straight line while everything else eased. It trails now
   * too, through the same follower.
   *
   * The flag exists because `progress` has two masters: this, and the open/close springs. The follower
   * must hand it back the instant the finger lifts, or it would fight `withSpring` for it.
   */
  const progressTarget = useSharedValue(1);
  const progressFollows = useSharedValue(false);

  // The follower. Every frame, close a time-proportional fraction of the gap between where a thing IS
  // and where the finger wants it. That single line is the whole "it should lerp behind the scroll, not
  // match it 1:1" — and because it keeps running after the finger lifts, it doubles as the settle: no
  // separate release animation to tune or keep in sync.
  useFrameCallback((frame) => {
    const dt = (frame.timeSincePreviousFrame ?? 16) / 1000;
    const k = 1 - Math.exp(-dt / FOLLOW_TAU);

    const gap = expandTarget.value - expand.value;
    if (Math.abs(gap) < 0.0005) expand.value = expandTarget.value;
    else expand.value += gap * k;

    if (progressFollows.value) {
      const pGap = progressTarget.value - progress.value;
      if (Math.abs(pGap) < 0.0005) progress.value = progressTarget.value;
      else progress.value += pGap * k;
    }
  });


  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Vertical intent only: a horizontal drag must reach the page rail (a horizontally-scrolling
        // list inside the panel) rather than being swallowed as a resize.
        .activeOffsetY([-8, 8])
        .failOffsetX([-16, 16])
        .onStart(() => {
          cancelAnimation(progress);
          // Take `progress` off the springs and hand it to the follower for the duration of the drag.
          progressFollows.value = true;
          progressTarget.value = progress.value;
          // The pan drives the TARGET, never `expand` itself — the follower owns that. Start from where
          // the panel actually IS, not from the target, so grabbing it mid-settle picks it up where you
          // can see it rather than snapping to where it was headed.
          panStartExpand.value = expand.value;
          expandTarget.value = expand.value;
          overscroll.value = 0;
        })
        .onUpdate((e) => {
          // The column moves WITH the finger, like a scroll: drag UP and the panel shrinks so the menu
          // below rises into view; drag DOWN and it grows back over it. Geared down by DRAG_GAIN, and
          // the panel then TRAILS this target rather than pinning itself to the thumb.
          const range = dragRange;
          const raw =
            range > 0
              ? panStartExpand.value + (e.translationY * DRAG_GAIN) / range
              : panStartExpand.value;

          if (raw > 1 || range <= 0) {
            // Past the top of the range (or nothing to resize at all): dragging DOWN now pulls the
            // whole popup back toward the card it came from. `progress` is the open morph, so this IS
            // the open animation running backwards under your thumb. This one DOES track the finger 1:1
            // — a dismiss you're performing yourself should answer immediately.
            const over = range > 0 ? ((raw - 1) * range) / DRAG_GAIN : Math.max(0, e.translationY);
            expandTarget.value = 1;
            overscroll.value = over;
            progressTarget.value = 1 - Math.min(1, over / DISMISS_DRAG);
            return;
          }

          if (raw < 0) {
            // Past the bottom of the range — this direction does NOT dismiss. Dragging up is how you
            // reach the menu, and reaching for the menu should never throw the popup away. It just
            // rubber-bands: resisted, capped, and eased back on release.
            expandTarget.value = Math.max(-RUBBER_LIMIT, raw * RUBBER_RESIST);
            overscroll.value = 0;
            progressTarget.value = 1;
            return;
          }

          expandTarget.value = raw;
          overscroll.value = 0;
          progressTarget.value = 1;
        })
        .onEnd((e) => {
          // Only a DOWNWARD pull dismisses (overscroll is only ever set by that branch above), either
          // by distance or by a flick that's still heading that way.
          const past = overscroll.value > DISMISS_RELEASE_PX;
          const flicked = overscroll.value > 0 && e.velocityY > DISMISS_RELEASE_VELOCITY;
          // Hand `progress` back to the springs before either branch touches it.
          progressFollows.value = false;
          if (past || flicked) {
            runOnJS(dismiss)();
            return;
          }

          progress.value = withSpring(1, MORPH_SPRING);
          overscroll.value = 0;
          if (dragRange > 0) {
            // Pick the end the flick was heading for and just point the TARGET at it — the follower
            // eases the panel over, with the same lag it had under the finger. There is no separate
            // release animation, which is the point: the settle can't feel different from the drag,
            // because it IS the drag's motion, still running.
            const velocity = (e.velocityY * DRAG_GAIN) / dragRange; // px/s → range units/s
            // Project from the TARGET — where the finger actually got to — not from `expand`, which is
            // deliberately lagging behind it. Judge the flick by what the user did, not by how far the
            // panel had managed to follow them by the time they let go.
            const projected = expandTarget.value + velocity * FLING_PROJECTION;
            expandTarget.value = projected >= 0.5 ? 1 : 0;
          }
        }),
    [dismiss, dragRange, expand, expandTarget, overscroll, panStartExpand, progress, progressFollows, progressTarget],
  );

  // Tap the backdrop to dismiss. A GESTURE, not a Pressable: the root pan and a Pressable are two
  // different touch systems, and the Pressable still fired its press on release after a pan had
  // already run — so a resize drag that happened to start on the backdrop also dismissed the popup.
  // As a gesture it simply loses the race to the pan the moment the finger travels.
  //
  // `success` is NOT optional here: RNGH calls onEnd when the gesture ends *however* it ended,
  // including when it FAILED — so without this check every drag ended in a dismiss, which is exactly
  // the bug this replacement was meant to fix.
  const tapDismiss = useMemo(
    () =>
      Gesture.Tap()
        // A tap is a tap, not a drag that happened to end. Without a distance bound the backdrop
        // counted a 200px resize drag as a successful tap and dismissed the popup underneath it.
        .maxDistance(10)
        .onEnd((_e, success) => {
          if (success) runOnJS(dismiss)();
        }),
    [dismiss],
  );

  const backdropBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 0.3, 1], [0, 0, BACKDROP_BLUR]),
  }));
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 0, BACKDROP_TINT_OPACITY]),
  }));
  // The panel fades in at its position, and SCALES about its top-left corner — the whole preview,
  // cover and text and rail together, zooming out to make room for the menu rather than being cropped.
  // Scaling is transform-only, so resizing costs no layout at all.
  const panelStyle = useAnimatedStyle(() => {
    const scale = minS.value + expand.value * (maxS.value - minS.value);
    const top = topMin.value + expand.value * (topMax.value - topMin.value);
    return {
      opacity: interpolate(progress.value, [0, 0.4, 1], [0, 0, 1]),
      transform: [{ translateX: panelPos.x.value }, { translateY: top }, { scale }],
    };
  });
  // The cover morphs from the card; stays opaque (the source card is hidden behind it). Both ends of
  // the FLIP are live, so a corrected card rect or a shifted slot bends the path instead of cutting it.
  // Y is offset by the clip band's origin, since the cover is laid out inside it (see `coverClip`).
  const coverStyle = useAnimatedStyle(() => {
    // The slot, in screen coords, at the panel's live scale (the panel scales about its own top-left).
    const scale = minS.value + expand.value * (maxS.value - minS.value);
    const top = topMin.value + expand.value * (topMax.value - topMin.value);
    const toX = panelPos.x.value + coverSlotLocalX * scale;
    const toY = top + coverSlotLocalY * scale;
    return {
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [coverFrom.x.value, toX]) },
      // Minus the band's origin: the cover is laid out inside it. A CONSTANT — the band's geometry
      // never changes now; only whether it clips (see `clipping`), which costs the cover nothing.
      { translateY: interpolate(progress.value, [0, 1], [coverFrom.y.value, toY]) - chromeTop },
      { scale: interpolate(progress.value, [0, 1], [coverFrom.scale.value, scale]) },
    ],
    shadowOpacity: progress.value * 0.28,
    };
  });
  // Counter-scale the radius so the cover's visual corner stays a constant 10px — at BOTH ends now,
  // since the resting cover is no longer at scale 1 but at the panel's scale.
  // Whether the band is CLIPPING right now. Binary, and it should be: the cover is either poking out of
  // the chrome or it isn't. It starts clipped (the cover lifts out from under the bars, which is the
  // whole point of the band) and stops the moment the cover is entirely inside it — at which instant
  // switching the clip off is provably invisible, because there is nothing left to clip.
  //
  // The band's GEOMETRY never changes; only `overflow` does. That's what makes this cheap: the previous
  // version interpolated the band's top/height, which are LAYOUT props, so it ran a layout pass every
  // frame of the morph. It also means the cover's offset into the band is a constant, so there's no
  // one-frame disagreement between the band moving and the cover compensating for it.
  //
  // (There is no z-order to swap here, which is the other thing you'd reach for: the bars live deep
  // inside the navigator and this is a root overlay, so the cover is ALREADY above them at every
  // moment. The clip is the only thing that can make it read as underneath.)
  // The test is the PHASE of the morph, not the cover's position — which is the trap here. "Clip
  // whenever the cover pokes out of the band" sounds right and is exactly wrong: once the menu is out
  // and the panel has ridden up, the cover legitimately sits over the top bar, and a position test says
  // "outside the band → clip it", cutting off the very thing we're trying to stop cutting off.
  //
  // The band's job is only ever to hide the cover while it's still emerging FROM THE CARD, under the
  // chrome the card itself scrolls under. That's the first moments of the lift and nothing else. So:
  // clipped early, free after. Reversed on the way back down, so it slides under the bars again as it
  // returns to the card.
  const [clipping, setClipping] = useState(true);
  useAnimatedReaction(
    () => progress.value < CLIP_UNTIL,
    (isEarly, wasEarly) => {
      if (isEarly !== wasEarly) runOnJS(setClipping)(isEarly);
    },
  );
  const coverRadiusStyle = useAnimatedStyle(() => {
    const scale = minS.value + expand.value * (maxS.value - minS.value);
    const live = interpolate(progress.value, [0, 1], [coverFrom.scale.value, scale]);
    return { borderRadius: 10 / Math.max(0.01, live) };
  });
  // The menu isn't dragged and isn't scaled — it TRACKS the panel's scaled bottom edge. Its position
  // is derived from the same value the panel's scale is, so resizing slides the menu in lockstep with
  // no second animation to keep in sync (that's the whole trick: one value, two consumers).
  const menuStyle = useAnimatedStyle(() => {
    const scale = minS.value + expand.value * (maxS.value - minS.value);
    const top = topMin.value + expand.value * (topMax.value - topMin.value);
    return {
      opacity: progress.value,
      transform: [
        { translateX: menuPos.x.value },
        {
          translateY: top + naturalH.value * scale + GAP + interpolate(progress.value, [0, 1], [-10, 0]),
        },
        { scale: interpolate(progress.value, [0, 1], [0.9, 1]) },
      ],
    };
  });

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

  // ── The rows, as data ─────────────────────────────────────────────────────
  // Rendering them from a list (rather than three hand-written JSX rows) is what lets a ROW INDEX mean
  // something — which is what the held finger is hit-tested into, and what a lift commits.
  const rows: MenuRowSpec[] = [
    {
      label: reading.label,
      Icon: PlayIcon,
      primary: true,
      loading: false,
      onPress: () => {
        req.onClose?.(); // un-hide the card and drop the overlay — the reader is about to cover it
        closeSeriesCardMenu();
        reading.start();
      },
    },
    {
      label: inLibrary ? 'Remove from Library' : 'Add to Library',
      Icon: inLibrary ? CheckIcon : PlusIcon,
      loading: inLibrary === null,
      active: !!inLibrary,
      onPress: () => act(toggleLibrary),
    },
    {
      label: favorited ? 'Unfavorite' : 'Favorite',
      Icon: StarIcon,
      iconFilled: !!favorited,
      loading: favorited === null,
      active: !!favorited,
      onPress: () => act(toggleFavorite),
    },
    // DEV ONLY: dummy rows so the menu is long enough to overrun the screen, which is the only state
    // the pan gesture exists for. See DEBUG_EXTRA_MENU_ROWS.
    ...Array.from({ length: DEBUG_EXTRA_MENU_ROWS }, (_, i) => ({
      label: `Placeholder action ${i + 1}`,
      Icon: PlusIcon,
      loading: false,
      onPress: dismiss,
    })),
  ];

  // What a lift runs. Registered rather than passed, because the finger that lifts belongs to the
  // CARD's gesture, which knows nothing about this component (see lib/series-card-menu).
  useEffect(() => {
    setMenuRowActions(rows.map((r) => (r.loading ? () => {} : r.onPress)));
  });

  // ── Peek and commit ───────────────────────────────────────────────────────
  // While the original long-press is STILL held, work out which row the finger is over and light it up;
  // lifting runs it. The row rects aren't measured — they're derived, exactly as the menu's own position
  // is (same value, same formula), so this stays a pure UI-thread computation with nothing to keep in
  // sync and no per-row onLayout.
  //
  // Only the finger's HEIGHT is tested, not its horizontal position: a row is selected by being level
  // with it, anywhere across the screen. The menu is a narrow strip pinned to the left edge, so
  // requiring the finger to be inside it means holding your thumb over the very thing you're choosing
  // from — and a thumb that drifts a few px off the right edge shouldn't drop the selection. Sliding
  // out to the empty space beside the menu and running up and down it works, which is what you actually
  // do. Off the TOP (into the preview) or below the last row still selects nothing.
  useAnimatedReaction(
    () => {
      // Not armed = you haven't reached for anything yet, so nothing is selected — which is what stops
      // a plain hold-and-release from running whatever row happened to be under your thumb.
      if (!holdActive.value || !holdArmed.value) return -1;
      const scale = minS.value + expand.value * (maxS.value - minS.value);
      const top = topMin.value + expand.value * (topMax.value - topMin.value);
      const menuTop = top + naturalH.value * scale + GAP;
      const local = holdY.value - menuTop - MENU_PAD_V;
      if (local < 0) return -1;
      const index = Math.floor(local / ROW_HEIGHT);
      return index >= 0 && index < rowCount ? index : -1;
    },
    (row, prev) => {
      if (row === prev) return;
      hoveredRow.value = row;
      // The little tick as the selection moves between rows — the thing that makes the iOS one feel
      // like it has detents rather than being a hover state.
      if (row >= 0) runOnJS(selectionTick)();
    },
  );

  return (
    // The pan lives on the ROOT, so the resize/dismiss drag works anywhere on the screen — over the
    // backdrop, the panel, or the menu — which is the point of it. It only claims a gesture once the
    // finger has travelled vertically (see activeOffsetY), so taps still reach the menu rows and the
    // backdrop, and a horizontal drag still belongs to the page rail.
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Blurred, tap-to-dismiss backdrop. */}
        <GestureDetector gesture={tapDismiss}>
          <View style={StyleSheet.absoluteFill}>
            <AnimatedBlurView tint="dark" experimentalBlurMethod={ANDROID_BLUR} animatedProps={backdropBlurProps} style={StyleSheet.absoluteFill} />
            <Animated.View style={[StyleSheet.absoluteFill, styles.backdropTint, backdropTintStyle]} />
          </View>
        </GestureDetector>

      {/* Panel background + content — fades in at the final position. `box-none` so taps fall through
          to the dismiss backdrop while the page rail's FlatList still receives touches. The cover slot
          is a transparent placeholder; the real cover is the morphing layer below. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.panelWrap, { width: panelW }, panelStyle]}>
        <Animated.View style={[styles.panel, { backgroundColor: theme.backgroundPanel }]}>
          {/* Measured so the scale range knows how tall the preview actually wants to be — the panel is
              never squeezed, only SCALED, so this natural height is what the whole range is derived from
              (and what the menu's tracked position is computed against). */}
          <View style={styles.panelContent} onLayout={(e) => setContentH(e.nativeEvent.layout.height)}>
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
          {/* Every group folded into ONE row, each chip in its group's colour (see TagStrip). A row
              per group was the single biggest thing making this panel tall — and the colour is the
              same one the series page puts on those tags, so the strip stays readable. */}
          {detailLoaded ? (
            <TagStrip
              genres={detail.data?.genres}
              groups={detail.data?.tagGroups}
              contentInset={PANEL_PAD}
              onTagPress={onTagPress}
            />
          ) : (
            <TagsSkeleton />
          )}
          {direct ? (
            <PageRail thumbs={pageList.data?.pageThumbs} loading={pageList.isLoading} bridgeId={bridgeId} seed={entry.id} onOpenPage={openReaderAt} />
          ) : null}
          </View>
        </Animated.View>
      </Animated.View>

      {/* The cover — morphs out of the card, on top of the (fading-in) panel, clipped to the band
          between the bars so it emerges from under the chrome instead of over it (see "Chrome band"). */}
      <View
        pointerEvents="none"
        style={[
          styles.coverClip,
          { top: chromeTop, height: chromeBottom - chromeTop, overflow: clipping ? 'hidden' : 'visible' },
        ]}>
        <Animated.View pointerEvents="none" style={[styles.coverLayer, { width: COVER_W, height: coverH }, coverStyle]}>
          <Animated.View style={[styles.coverInner, coverRadiusStyle]}>
            {entry.cover ? (
              <Image source={{ uri: entry.cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            ) : null}
          </Animated.View>
        </Animated.View>
      </View>

      {/* The actions menu — a frosted (blurred) panel. It is never dragged: its position is DERIVED
          from the panel's live height (see menuStyle), so it tracks the panel's bottom edge as the pan
          resizes it, and eases with it when late content changes the panel's natural height. */}
      <Animated.View style={[styles.menuWrap, { width: menuW }, menuStyle]}>
        <BlurView tint={menuTint} intensity={MENU_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={[styles.menu, { borderColor: theme.backgroundSelected }]}>
          {rows.map((row, i) => (
            <MenuRow key={i} {...row} index={i} />
          ))}
        </BlurView>
      </Animated.View>
      </View>
    </GestureDetector>
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
// than a jarring pop-in. Shapes mirror the real elements: a meta line, a few description lines, one
// row of tag pills, and a rail of page-sized tiles.

const SKELETON_CHIP_WIDTHS = [56, 44, 72, 38, 60, 50];
const RAIL_SKELETON_W = Math.round(RAIL_THUMB_H * DEFAULT_THUMB_ASPECT);

/** A single full-bleed row of pill placeholders — the tags always collapse to one row now
 *  (see TagStrip), so the skeleton is exactly the shape the real thing lands in. */
function TagsSkeleton() {
  return (
    <View style={styles.tagRowSkeleton}>
      {SKELETON_CHIP_WIDTHS.map((w, i) => (
        <Skeleton key={i} style={[styles.chipSkeleton, { width: w }]} />
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
 * ⚠️ NO `theme.accent` (BLUE) IN THIS MENU — not on the state toggles, and NOT on the Read row.
 * Do not "promote" the primary action by tinting it blue; that has now been done twice and reverted
 * twice. The blue chip/label look is disliked here, full stop. If a row needs to stand out, use
 * WEIGHT and POSITION (Read is bold and it leads), never hue.
 *
 * So nothing in this menu is coloured:
 *   • Read is bold, first, and carries a solid play glyph — that's what makes it primary.
 *   • The toggles keep the plain label colour whether on or off, and say which they are through the
 *     glyph alone: a checkmark once in the library, a filled star once favourited.
 *
 * The original sin was `accent` carrying two meanings at once — "this is tappable" AND "this is on" —
 * which made "in Library" shout louder than the thing you actually opened the menu to do.
 */
export type MenuRowSpec = {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** Fill the glyph rather than tint it — how an "on" toggle reads (see above). */
  iconFilled?: boolean;
  loading: boolean;
  active?: boolean;
  /** The menu's one real action (Read): bold and leading. NOT coloured — see above. */
  primary?: boolean;
  onPress: () => void;
};

function MenuRow({
  label,
  Icon,
  iconFilled,
  loading,
  active,
  primary,
  index,
  onPress,
}: MenuRowSpec & {
  /** This row's position, which is what the held finger is hit-tested into (see "Peek and commit"). */
  index: number;
}) {
  const theme = useTheme();
  // Lit up while the still-held finger is over this row. Opacity, not a background swap: it animates on
  // the UI thread with no re-render, and there is one of these per row.
  const highlight = useAnimatedStyle(() => ({ opacity: hoveredRow.value === index ? 1 : 0 }));
  const color = loading ? theme.textSecondary : theme.text;
  // An off toggle's glyph sits back a little, so the on-state (solid glyph, full contrast) reads as
  // a change without needing a colour of its own.
  const iconColor = loading ? theme.textSecondary : primary || active ? color : theme.textSecondary;
  return (
    <Pressable
      onPress={loading ? undefined : onPress}
      disabled={loading}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.rowBubble, { backgroundColor: theme.backgroundSelected }, highlight]}
      />
      <ThemedText style={[styles.rowLabel, primary && styles.rowLabelPrimary, { color }]} numberOfLines={1}>
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
    // Scale about the TOP-LEFT: the panel is pinned there, grows/shrinks downward and rightward from
    // it, and the cover's resting slot is computed in the same frame of reference (panelTop/Left +
    // local * scale). A centre origin would drift both.
    transformOrigin: '0% 0%',
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  panelContent: {
    // The preview at its natural size. The panel is SCALED as a whole (see panelStyle), never
    // squeezed, so this never reflows — the resize costs no layout at all.
    gap: Spacing.three,
  },
  panel: {
    borderRadius: 16,
    // Only vertical padding: the horizontal scrollers (tags, page rail) bleed to the panel's rounded
    // edges (clipped by `overflow: hidden`) so their content isn't cut off at an inset viewport; they
    // carry their own leading inset (`PANEL_PAD`) instead. The top row re-adds horizontal padding.
    paddingVertical: PANEL_PAD,
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
  // Full-bleed horizontally; vertically it spans only the gap between the bars, and clips the cover to
  // it. Transparent and non-interactive — it exists purely as the clip boundary.
  coverClip: {
    // Geometry fixed; `overflow` is toggled per-render (see `clipping`), never animated.
    position: 'absolute',
    left: 0,
    right: 0,
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
  // The selection bubble: inset from the row's edges and generously rounded, so it reads as a pill
  // sitting on the menu rather than a full-bleed band lighting up. Inset, because a bubble that touched
  // the menu's own rounded edge would look like a rendering artefact rather than a shape.
  rowBubble: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: Spacing.one,
    right: Spacing.one,
    borderRadius: 10,
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
  // Read leads and is bold — that is the ONLY way it's marked as primary. No colour. See MenuRow.
  rowLabelPrimary: {
    fontWeight: '600',
  },
});
