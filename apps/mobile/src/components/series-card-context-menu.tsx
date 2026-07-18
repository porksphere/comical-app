import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
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
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';

import { NATIVE_HIDE_OFFSET } from '@/components/app-tabs';
import { TagStrip } from '@/components/chip';
import {
  ANDROID_BLUR,
  BACKDROP_BLUR,
  BACKDROP_TINT,
  BACKDROP_TINT_OPACITY,
  HIGHLIGHT_OPACITY,
  HOVER_FADE,
  HOVER_SPRING,
  MENU_PAD_V,
  MENU_ROW_HEIGHT as ROW_HEIGHT,
  MENU_WIDTH,
  MenuSurface,
  menuStyles,
  SUBMENU_DIVIDER_H,
  SUBMENU_MAX_LIST_HEIGHT,
  SubmenuSurface,
  type MenuRowSpec,
  type SubmenuSpec,
} from '@/components/context-menu-material';
import { CheckIcon, ChevronRightIcon, DownloadsIcon, PlayIcon, PlusIcon, StarIcon } from '@/components/icons/ui-icons';
import { PageThumb } from '@/components/series/chapters-section';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { setSearchIntent, tagSearchIntent } from '@/data/search-intent';
import type { TagGroup } from '@/data/mock';
import { seriesDetailQuery, seriesListQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { PageThumbSource } from '@/data/types';
import { useEntryLists } from '@/hooks/use-entry-lists';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import { useLibraryLists } from '@/hooks/use-library-lists';
import { useSeriesDownloadAction } from '@/hooks/use-series-download-action';
import { useIsLargeScreen, useTopBarHeight } from '@/hooks/use-responsive';
import { useStartReading } from '@/hooks/use-start-reading';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { testId } from '@/lib/test-id';
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
/**
 * The tick as the held finger crosses from one row to the next — what gives the menu its detents, so
 * dragging down it feels like clicking through positions rather than sweeping over a hover state.
 *
 * `selectionAsync`, the faintest thing the Taptic Engine does — and deliberately so. It fires on every
 * row you cross, which is many times per drag, against the ONE medium impact that opens the popup. If
 * the two were comparable in weight the drag would rattle and the open would stop being an event. The
 * ticks are punctuation, not the sentence.
 */
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
// The submenu's pop-out. It blooms in place at the row you just tapped (nothing travels), so it can
// be lighter than the MORPH — but it must NOT feel snappier than a normal context menu opening. Tuned
// to the same speed family as the generic hold-menu's OPEN_SPRING (context-menu-host.tsx): it was
// noticeably faster than every other menu open, which read as a different, cheaper object.
const SUBMENU_SPRING = { damping: 20, stiffness: 300, mass: 0.7 } as const;
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
const REST_COVER_RADIUS = 10; // the preview cover's resting VISUAL corner radius (also the default start)
// How long the open morph waits for the lifted cover's bitmap before starting anyway. The cover is
// virtually always in the memory cache (its card is on-screen), so onLoad fires within a frame or two
// and this ceiling is never reached; it's only a safety valve so a decode failure can't hang the open.
const COVER_DECODE_WAIT_MS = 180;
const RAIL_THUMB_W = 64; // nominal fallback width (unused in slot mode: PageThumb sizes to slotHeight)
const RAIL_THUMB_H = 180; // the rail's fixed tile height; each tile's width follows its own page aspect
const RAIL_GAP = Spacing.two;
// Meta + description slots. The skeleton reserves their expected space so a fresh (uncached) series
// opens near the height it settles to; once the detail lands, both collapse to their REAL content —
// a series with no description (or no meta) no longer carries a permanently-empty reserve, which was
// most visible on landscape covers, where the info column is what sets the panel's height. The
// resulting height change rides the panel's existing content-geometry springs (see `resizeReady`).
const SMALL_LINE_H = 20; // ThemedText "small" lineHeight
const META_H = SMALL_LINE_H; // one line
const DESC_LINES = 3;
const DESC_H = DESC_LINES * SMALL_LINE_H;
// Rolling "last measured" description height — the same trick as series-card.tsx's rolling cover
// aspect: each popup OPENS assuming the previous popup's description size (instead of always the
// full 3-line reserve), then eases to the real size when its own detail resolves. Most catalogues
// are homogeneous (all described, or none), so the assumption is usually right and the panel
// doesn't move at all.
let lastDescHeight = DESC_H;
// Rough panel height before it's measured, so the menu is roughly placed on frame one.
const PANEL_HEIGHT_ESTIMATE = 190;
// MENU_WIDTH / ROW_HEIGHT / MENU_PAD_V / the highlight + hover constants live in
// `context-menu-material.tsx` now (imported above) — shared with the generic ContextMenuHost so the
// two hold menus render the exact same object.
// How long a press ON THE MENU must be held before it becomes a peek (see `menuHold`). Shorter than the
// card's 350ms: the popup is already open and your finger is already on the thing you're choosing from,
// so there's far less to disambiguate — only a tap and a resize drag, and both are quick by nature.
const MENU_HOLD_MS = 220;
// How long the held finger must DWELL on a submenu-bearing row (mid-drag) before that submenu opens
// under it — the iOS "hover a folder to spring it open" delay. Long enough that merely sweeping PAST
// the row on the way to another doesn't trip it, short enough that a deliberate pause feels answered.
const SUBMENU_DWELL_MS = 320;
// Read + Add to Library + Add to list + Favorite + Download. Keep in step with the rows rendered
// below — the menu's height is computed from this (it's what the panel's resize range budgets for),
// not measured.
const MENU_ROWS = 5;
// DEV ONLY: pad the menu out with dummy rows, to exercise the case the pan gesture exists for — a
// group too tall for the screen, where the panel has to give up height for the menu to be reachable.
//
// Leave it at 0. While it's non-zero it DISTORTS THE LAYOUT — an 11-row menu plus a full-size preview
// doesn't fit anywhere but the top of the screen once MIN_VISIBLE_ROWS of it must also be on screen —
// so the popup will sit high and that is the invariant working, not the placement failing.
const DEBUG_EXTRA_MENU_ROWS = 0;

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
// The backdrop/menu material (blur strengths, theme-following scrim tints, the menu's surface fill)
// lives in `context-menu-material.tsx` — see its docstring for the full "what makes a frosted
// surface" and "the scrim follows the theme" reasoning, which was written here first.

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
  const { entry, bridgeId, direct, coverAspect, rect } = req;
  // The VISUAL corner radius the preview starts at (matches the source it lifts from); it morphs to the
  // resting radius (REST_COVER_RADIUS) as it opens. Defaults to that resting radius (a card cover).
  const startRadius = req.startRadius ?? REST_COVER_RADIUS;
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
  // The description reserve THIS popup opened assuming (captured once — the rolling value must not
  // move the skeleton mid-open when another popup writes it). A loaded empty description records 0,
  // so the next popup on a description-less catalogue opens compact instead of reserving 3 lines.
  const [assumedDescH] = useState(lastDescHeight);
  useEffect(() => {
    if (detailLoaded && !detail.data?.description) lastDescHeight = 0;
  }, [detailLoaded, detail.data?.description]);

  const { favorited, toggle: toggleFavorite, available: favoritesAvailable } = useFavorite(bridgeId, entry.id);
  const { inLibrary, toggle: toggleLibrary } = useLibrary(bridgeId, entry.id, () => ({
    title: entry.title,
    ...(entry.cover ? { thumbnailUrl: entry.cover } : {}),
  }));
  // Custom lists for the "Add to list ›" submenu: the collection (drives chevron-vs-＋ and the
  // expanded rows) + this series' live memberships (the checkmarks, optimistic). Both queries run
  // once per open — this component mounts only while the menu is up, never per card. Each gates its
  // own surface while loading: the ROW is inert until the collection resolves (otherwise a quick tap
  // reads a still-loading [] as "no lists" and wrongly takes the ＋→manage path), and the submenu
  // rows are inert until the memberships resolve (a toggle then would REPLACE unknown memberships).
  const { lists, isLoading: listsLoading } = useLibraryLists();
  const { listIds, loading: entryListsLoading, setLists } = useEntryLists(bridgeId, entry.id, () => ({
    title: entry.title,
    ...(entry.cover ? { thumbnailUrl: entry.cover } : {}),
  }));
  // Lazy: this panel mounts only while the menu is open, so the download-status query runs once here,
  // never per card in the grid.
  const download = useSeriesDownloadAction(
    bridgeId,
    entry.id,
    !!direct,
    { title: entry.title, ...(entry.cover ? { cover: entry.cover } : {}) },
    true,
  );

  // Start the open morph, once. Deferred until the lifted cover's bitmap is decoded (see `openMorph`
  // below) so it never flies out blank for a frame or two — expo-image decodes async even on a cache
  // hit when a fresh <Image> view mounts, and starting the spring on that same frame let the couple-
  // frame decode happen mid-flight. Now it happens while the cover rests (invisibly) on the hidden card.
  const openedRef = useRef(false);
  const openMorph = useCallback(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    progress.set(withSpring(1, MORPH_SPRING));
  }, [progress]);

  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); // fire immediately — the press must feel instant
    // Nothing to wait for without a cover; otherwise the cover's onLoad drives the open, with this as a
    // fallback so a missing/failed decode still opens the menu.
    if (!entry.cover) {
      openMorph();
      return;
    }
    const t = setTimeout(openMorph, COVER_DECODE_WAIT_MS);
    return () => clearTimeout(t);
  }, [entry.cover, openMorph]);

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
    progress.set(withSpring(0, CLOSE_SPRING, (finished) => {
      if (finished) runOnJS(finishClose)();
    }));
  }, [progress, finishClose]);

  useEffect(() => {
    // Android hardware-back dismisses the popup; BackHandler is native-only (it raises a red dev
    // toast on web, where the web hold-menu path opens this via the dev hook).
    if (Platform.OS === 'web') return;
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
  // The MENU gets a lower floor than the panel does, and this distinction matters more than it looks.
  //
  // `bottomLimit` stops above the tab bar, because the PANEL is chrome-aware: it's the preview, and it
  // reads better kept off the bars (and the cover, which lives inside it, must stay clear of them —
  // see the clip band). But the menu isn't the preview. It's rendered ABOVE everything, including the
  // bars, so a row sitting over the tab bar is perfectly visible and perfectly tappable.
  //
  // Measuring the menu against the panel's floor was costing real movement: with the bars showing, it
  // insisted 4 rows fit into a box ~90px shorter than the space the menu actually has, and paid for
  // that by dragging the whole popup — cover and all — up the screen. Which is exactly why the symptom
  // only appeared with the grid scrolled to the TOP: scroll down, the bars hide, `chromeBottom` becomes
  // the screen bottom, and the two floors coincide.
  const menuBottomLimit = winH - insets.bottom - EDGE_PAD;

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
  const fitScale = (menuBottomLimit - topLimit - GAP - menuH) / naturalPanelH;
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

  // The open ANCHOR has to satisfy both invariants; within what they leave, it moves as little as it
  // possibly can. In priority order:
  //
  //   1. HARD  the panel opens fully sized and fully on screen. Non-negotiable — an undersized or
  //            clipped preview isn't a preview.
  //   2. HARD  at least MIN_VISIBLE_ROWS of the menu are on screen AT THE ANCHOR. A popup whose actions
  //            are all below the fold doesn't read as a menu, however swipeable it is.
  //   3. THEN  minimise the cover's movement: aim it at exactly where the card's cover already is.
  //
  // The clamp is the only thing that ever moves the cover, and it moves it the least the two invariants
  // allow. What it must NOT do is what it did before: when (2) couldn't be met at all, it pinned the
  // panel to `topLimit` — the top of the screen — throwing the card's position away entirely rather
  // than getting as close as it could. That's the bug that made the popup "open at the top once the
  // grid was scrolled": whether (2) was satisfiable depends on the space available, and the bars hiding
  // on scroll changes it. When (2) is impossible, fall back to (1) and stay as near the card as that
  // allows — never to the top of the screen.
  const wantRows = Math.min(MIN_VISIBLE_ROWS, menuRowCount);
  const minMenuVisibleH = MENU_PAD_V * 2 + ROW_HEIGHT * wantRows;
  const lowestForPanel = bottomLimit - panelHAtMax; // (1) — the PANEL stays inside the chrome band
  const lowestForMenu = menuBottomLimit - minMenuVisibleH - GAP - panelHAtMax; // (2) — the MENU may float over the bars
  const lowestTop = lowestForMenu > topLimit ? lowestForMenu : Math.max(topLimit, lowestForPanel);
  const topAtMax = clamp(idealTop, topLimit, lowestTop);

  // Where a swipe takes it: far enough up (and small enough) for the whole menu to sit below the panel.
  // Not clamped to the band's top — a menu too long to fit even at MIN_PANEL_SCALE would otherwise
  // leave its last rows unreachable, and the collapsed end IS the end of the range.
  const topAtMin = Math.min(menuBottomLimit - (panelHAtMin + GAP + menuH), bottomLimit - panelHAtMin);

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
      sv.set(resizeReady && !first ? withSpring(v, MORPH_SPRING) : v);
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
    if (Math.abs(gap) < 0.0005) expand.set(expandTarget.value);
    else expand.set(expand.value + gap * k);

    if (progressFollows.value) {
      const pGap = progressTarget.value - progress.value;
      if (Math.abs(pGap) < 0.0005) progress.set(progressTarget.value);
      else progress.set(progress.value + pGap * k);
    }
  });

  // ── In-place submenu (the iOS Files "Open With ›" expansion) ───────────────
  // A row with a `submenu` builder expands INTO a new menu card anchored exactly at that row, while
  // the parent stack (menu + preview) is pushed back — dimmed — behind it. The card unfolds out of its
  // own header (see submenuOuterStyle/submenuClipStyle); the header is the row restated with a down
  // chevron; tapping it collapses back.
  //
  // Geometry is arithmetic, not measurement: a row's top inside the menu is MENU_PAD_V + i*ROW,
  // and the menu's own screen position is derived from the same shared values `menuStyle` uses —
  // read once at open (they're settled whenever a row is tappable). The card renders INSIDE the
  // menu's transformed container, so it tracks the menu without its own position plumbing; `shift`
  // pulls it up only as far as needed for the (capped) row area to clear the screen bottom.
  const [submenuGeom, setSubmenuGeom] = useState<{ row: number; anchorTop: number; listH: number } | null>(null);
  const submenuOpen = submenuGeom !== null;
  const submenuProgress = useSharedValue(0);
  const submenuShift = useSharedValue(0);
  // The expanded list's scroll offset, reported back from the surface — the hold hit-test needs it to
  // map the finger into a SCROLLED row (arithmetic, same as the parent menu, now scroll-aware).
  const submenuScrollY = useSharedValue(0);

  const openSubmenu = (rowIndex: number, spec: SubmenuSpec) => {
    const rowsH = spec.rows.length * ROW_HEIGHT;
    let listH = Math.min(rowsH, spec.maxHeight ?? SUBMENU_MAX_LIST_HEIGHT);
    // Where the tapped row sits on screen right now (same formula as menuStyle, values settled).
    const scale = minS.value + expand.value * (maxS.value - minS.value);
    const menuScreenTop =
      topMin.value + expand.value * (topMax.value - topMin.value) + naturalH.value * scale + GAP;
    const anchorTop = MENU_PAD_V + rowIndex * ROW_HEIGHT;
    const rowScreenTop = menuScreenTop + anchorTop;
    // Header row + the surface's own vertical padding — what the card needs beyond the row area.
    const chromeH = MENU_PAD_V * 2 + ROW_HEIGHT;
    // Slide up just enough to fit; never above the chrome band. If even that can't fit the capped
    // list, the list gives up height instead (it scrolls anyway).
    let shift = Math.min(0, menuBottomLimit - rowScreenTop - (chromeH + listH));
    if (rowScreenTop + shift < topLimit) {
      shift = topLimit - rowScreenTop;
      // Clamp to the rows' own height too: never reserve MORE than the rows need (that would leave the
      // reveal's clipped height taller than the surface, showing an empty gap below the last row).
      listH = Math.max(ROW_HEIGHT, Math.min(rowsH, menuBottomLimit - (rowScreenTop + shift) - chromeH));
    }
    submenuShift.set(shift);
    submenuScrollY.set(0); // fresh list, top of the scroll
    // Clear the selection carried over from the parent row so the submenu's own bubble doesn't flash
    // on a stale index for a frame before its hit-test (or a press) lands on a real child row.
    hoveredRow.set(-1);
    setSubmenuGeom({ row: rowIndex, anchorTop, listH });
    submenuProgress.set(withSpring(1, SUBMENU_SPRING));
  };
  const clearSubmenu = useCallback(() => {
    // Drop any leftover child selection before the parent hit-test takes `hoveredRow` back, so the
    // parent bubble doesn't briefly light the row at the child's last index.
    hoveredRow.set(-1);
    setSubmenuGeom(null);
  }, []);
  const collapseSubmenu = useCallback(() => {
    submenuProgress.set(
      withSpring(0, CLOSE_SPRING, (finished) => {
        if (finished) runOnJS(clearSubmenu)();
      }),
    );
  }, [submenuProgress, clearSubmenu]);

  // The parent stack, pushed back while the submenu is up: the menu recedes (it's what the submenu
  // covers), the preview dims more gently — depth, not disappearance. Kept DELIBERATELY subtle: an
  // earlier, heavier fade (menu → 0.5, preview → 0.7) washed the parent out so far it read as gone
  // rather than behind. The parent must stay clearly legible — you tap it to come back.
  const parentMenuPushStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.22 * submenuProgress.value,
    transform: [{ scale: 1 - 0.06 * submenuProgress.value }],
  }));
  const parentDimStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.12 * submenuProgress.value,
  }));
  // The submenu opens by UNFOLDING OUT OF ITS OWN HEADER — the card popover's trick (a separate
  // clipping layer fakes the morph). Two layers, both driven by `submenuProgress`:
  //   • OUTER travels: it starts at the anchor (header sitting directly over the parent row) and rides
  //     up to its final slot (`submenuShift`, which is 0 when there's already room below).
  //   • INNER clips: its height grows from just-the-header to the full card, so the rows unfurl
  //     downward while the whole thing rises — the header text pinned at the top the entire way.
  // The surface inside is always full-size; the inner layer's animated height + overflow-hidden is
  // what reveals it, so nothing reflows per frame (only the clip's height changes).
  const submenuFullH = MENU_PAD_V * 2 + ROW_HEIGHT + SUBMENU_DIVIDER_H + (submenuGeom?.listH ?? 0);
  const submenuCollapsedH = MENU_PAD_V + ROW_HEIGHT; // top padding + the header row alone
  const submenuOuterStyle = useAnimatedStyle(() => ({
    opacity: interpolate(submenuProgress.value, [0, 0.25, 1], [0, 1, 1]),
    transform: [{ translateY: submenuShift.value * submenuProgress.value }],
  }));
  const submenuClipStyle = useAnimatedStyle(() => ({
    height: interpolate(submenuProgress.value, [0, 1], [submenuCollapsedH, submenuFullH]),
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Parked while a submenu is expanded: its row area is a vertical SCROLL, which this pan
        // would otherwise claim as a resize/dismiss drag. iOS locks the parent the same way.
        .enabled(!submenuOpen)
        // Vertical intent only: a horizontal drag must reach the page rail (a horizontally-scrolling
        // list inside the panel) rather than being swallowed as a resize.
        .activeOffsetY([-8, 8])
        .failOffsetX([-16, 16])
        .onStart(() => {
          cancelAnimation(progress);
          // Take `progress` off the springs and hand it to the follower for the duration of the drag.
          progressFollows.set(true);
          progressTarget.set(progress.value);
          // The pan drives the TARGET, never `expand` itself — the follower owns that. Start from where
          // the panel actually IS, not from the target, so grabbing it mid-settle picks it up where you
          // can see it rather than snapping to where it was headed.
          panStartExpand.set(expand.value);
          expandTarget.set(expand.value);
          overscroll.set(0);
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
            expandTarget.set(1);
            overscroll.set(over);
            progressTarget.set(1 - Math.min(1, over / DISMISS_DRAG));
            return;
          }

          if (raw < 0) {
            // Past the bottom of the range — this direction does NOT dismiss. Dragging up is how you
            // reach the menu, and reaching for the menu should never throw the popup away. It just
            // rubber-bands: resisted, capped, and eased back on release.
            expandTarget.set(Math.max(-RUBBER_LIMIT, raw * RUBBER_RESIST));
            overscroll.set(0);
            progressTarget.set(1);
            return;
          }

          expandTarget.set(raw);
          overscroll.set(0);
          progressTarget.set(1);
        })
        .onEnd((e) => {
          // Only a DOWNWARD pull dismisses (overscroll is only ever set by that branch above), either
          // by distance or by a flick that's still heading that way.
          const past = overscroll.value > DISMISS_RELEASE_PX;
          const flicked = overscroll.value > 0 && e.velocityY > DISMISS_RELEASE_VELOCITY;
          // Hand `progress` back to the springs before either branch touches it.
          progressFollows.set(false);
          if (past || flicked) {
            runOnJS(dismiss)();
            return;
          }

          progress.set(withSpring(1, MORPH_SPRING));
          overscroll.set(0);
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
            expandTarget.set(projected >= 0.5 ? 1 : 0);
          }
        }),
    [dismiss, dragRange, expand, expandTarget, overscroll, panStartExpand, progress, progressFollows, progressTarget, submenuOpen],
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

  // Tapping the pushed-back PARENT menu closes only the submenu (iOS Files' behaviour), NOT the whole
  // popup — that's what tapping the empty backdrop does (tapDismiss above). A dedicated catcher over
  // the parent surface while the submenu is up, so a tap on the faded rows collapses back one level
  // instead of falling through to the backdrop and dismissing everything.
  const tapCollapse = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .onEnd((_e, success) => {
          if (success) runOnJS(collapseSubmenu)();
        }),
    [collapseSubmenu],
  );

  const backdropBlurProps = useAnimatedProps(() => ({
    // The card popup lifts a preview — the heavy frost mode sets it off against the page.
    intensity: interpolate(progress.value, [0, 0.3, 1], [0, 0, BACKDROP_BLUR.preview]),
  }));
  const scrimOpacity = BACKDROP_TINT_OPACITY[menuTint];
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 0, scrimOpacity]),
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
    // The VISUAL corner morphs from the source's radius to the resting radius over the open, then is
    // counter-scaled by the live scale so that visual radius is what lands on screen.
    const visualRadius = interpolate(progress.value, [0, 1], [startRadius, REST_COVER_RADIUS]);
    return { borderRadius: visualRadius / Math.max(0.01, live) };
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
      const intent = tagSearchIntent(group, index, { bridgeId: bridgeId ?? '' });
      if (!intent) return;
      setSearchIntent(intent);
      req.onClose?.();
      closeSeriesCardMenu();
      if (pathname !== '/search') router.push('/search');
    },
    [bridgeId, req, router, pathname],
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

  // The "Add to list" submenu, built fresh every render so the checkmarks track the optimistic
  // memberships as they're toggled (a snapshot taken at open would freeze them).
  const hasLists = lists.length > 0;
  const listsSubmenu = (): SubmenuSpec => ({
    label: 'Add to list',
    testID: 'series.card-menu.lists.submenu',
    rows: lists.map((l) => ({
      label: l.name,
      active: listIds.includes(l.id),
      loading: entryListsLoading,
      onPress: () =>
        setLists(listIds.includes(l.id) ? listIds.filter((x) => x !== l.id) : [...listIds, l.id]),
      testID: `series.card-menu.lists.${l.id}`,
    })),
  });
  // Its position in `rows` below — the submenu anchors at exactly this row's slot.
  const LISTS_ROW_INDEX = 2;

  const rows: MenuRowSpec[] = [
    {
      label: reading.label,
      Icon: PlayIcon,
      primary: true,
      loading: false,
      testID: 'series.card-menu.read',
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
      testID: 'series.card-menu.library',
      onPress: () => act(toggleLibrary),
    },
    {
      label: 'Add to list',
      // No lists yet → a ＋ that takes you to list management. With lists → a chevron that expands
      // the in-place submenu (iOS Files' "Open With ›"). The glyph IS the affordance either way.
      Icon: hasLists ? ChevronRightIcon : PlusIcon,
      // Inert until the collection has actually loaded — see the loading note on useLibraryLists.
      loading: listsLoading,
      testID: 'series.card-menu.lists',
      ...(hasLists && { submenu: listsSubmenu }),
      onPress: hasLists
        ? // Do NOT close the menu — the submenu expands over it while the rest pushes back.
          () => openSubmenu(LISTS_ROW_INDEX, listsSubmenu())
        : () => {
            req.onClose?.(); // navigating away — un-hide the card and drop the overlay
            closeSeriesCardMenu();
            router.push('/manage-lists');
          },
    },
    {
      label: favorited ? 'Unfavorite' : 'Favorite',
      Icon: StarIcon,
      iconFilled: !!favorited,
      loading: favorited === null,
      // Greyed + inert when this bridge's favorites need a login that isn't set (see useFavorite).
      disabled: !favoritesAvailable,
      active: !!favorited,
      testID: 'series.card-menu.favorite',
      onPress: () => act(toggleFavorite),
    },
    {
      label: download.label,
      Icon: DownloadsIcon,
      loading: download.loading,
      active: download.active,
      testID: 'series.card-menu.download',
      onPress: () => act(download.onPress),
    },
    // DEV ONLY: dummy rows so the menu is long enough to overrun the screen, which is the only state
    // the pan gesture exists for. See DEBUG_EXTRA_MENU_ROWS.
    ...Array.from({ length: DEBUG_EXTRA_MENU_ROWS }, (_, i) => ({
      label: `Placeholder action ${i + 1}`,
      Icon: PlusIcon,
      loading: false,
      testID: testId('series.card-menu.placeholder', i + 1),
      onPress: dismiss,
    })),
  ];

  // The live spec for whichever row's submenu is expanded — re-built from the row's builder every
  // render, so its checkmarks track the optimistic membership toggles (see listsSubmenu).
  const openSubmenuSpec = submenuGeom ? (rows[submenuGeom.row]?.submenu?.() ?? null) : null;

  // What a lift runs. Registered rather than passed, because the finger that lifts belongs to the
  // CARD's gesture, which knows nothing about this component (see lib/series-card-menu). While a
  // submenu is expanded the SAME lift commits a SUBMENU row instead — the drag flowed into it (see
  // the submenu hit-test below), so `hoveredRow` now indexes the submenu, and the commit must too.
  useEffect(() => {
    if (submenuOpen && openSubmenuSpec) {
      setMenuRowActions(openSubmenuSpec.rows.map((r) => (r.loading ? () => {} : r.onPress)));
    } else {
      setMenuRowActions(rows.map((r) => (r.loading || r.disabled ? () => {} : r.onPress)));
    }
  });

  // ── Spring-loaded submenu: dwell on a submenu row mid-drag to open it ───────
  // While the original hold-drag is sweeping the menu, pausing on a row that HAS a submenu springs it
  // open under the finger (iOS Files' folder behaviour), so the same uninterrupted drag then continues
  // into the child rows. Driven from the hit-test reaction below via a stable JS callback; refs keep
  // it reading the current rows / open-state without re-subscribing the worklet every render.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const submenuOpenRef = useRef(submenuOpen);
  submenuOpenRef.current = submenuOpen;
  const openSubmenuRef = useRef(openSubmenu);
  openSubmenuRef.current = openSubmenu;
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDwell = useCallback(() => {
    if (dwellRef.current) {
      clearTimeout(dwellRef.current);
      dwellRef.current = null;
    }
  }, []);
  const handleDragHover = useCallback(
    (row: number) => {
      // The finger moved to a new row (or off the menu) — any pending spring-open is stale.
      clearDwell();
      if (submenuOpenRef.current) return; // a submenu is already up; nothing to spring
      const r = rowsRef.current[row];
      const spec = r?.submenu;
      if (!spec || r.loading || r.disabled) return;
      dwellRef.current = setTimeout(() => openSubmenuRef.current(row, spec()), SUBMENU_DWELL_MS);
    },
    [clearDwell],
  );
  useEffect(() => clearDwell, [clearDwell]);
  // Lifting the finger cancels a pending spring-open — otherwise the lift-commit opens the submenu AND
  // the timer fires just after and opens it a second time.
  useAnimatedReaction(
    () => holdActive.value,
    (active, prev) => {
      if (prev && !active) runOnJS(clearDwell)();
    },
    [clearDwell],
  );

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
      // Frozen while a submenu is expanded — the SUBMENU hit-test below owns `hoveredRow` then. A
      // sentinel the handler ignores, so this one leaves the selection alone instead of fighting it.
      if (submenuOpen) return -2;
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
      if (row === -2 || row === prev) return;
      hoveredRow.set(row);
      // The little tick as the selection moves between rows — the thing that makes the iOS one feel
      // like it has detents rather than being a hover state.
      if (row >= 0) runOnJS(selectionTick)();
      // Dwell on a submenu-bearing row springs it open under the finger (see handleDragHover).
      runOnJS(handleDragHover)(row);
    },
    [submenuOpen, handleDragHover],
  );

  // ── The highlight itself ──────────────────────────────────────────────────
  // ONE bubble for the whole menu, not one per row: it TRAVELS to the hovered row. Per-row bubbles
  // could only blink on and off, and a selection you're dragging along the menu should move with your
  // thumb, not teleport ahead of it. The rows are a uniform height, so where it goes is arithmetic —
  // no per-row measurement, exactly as with the hit-test above.
  //
  // Arriving from nothing is a FADE, not a slide: the finger enters the menu at whatever row it enters
  // at, and having the bubble skate up from row 0 to meet it would be inventing a movement that didn't
  // happen. So it only slides between rows once it's already showing.
  const hoverY = useSharedValue(0);
  const hoverOn = useSharedValue(0);
  useAnimatedReaction(
    // Off while a submenu is up — `hoveredRow` then indexes the SUBMENU, and the faded parent must not
    // light one of its own rows to match. Its bubble fades out; the submenu's takes over.
    () => (submenuOpen ? -1 : hoveredRow.value),
    (row, prev) => {
      if (row === prev) return;
      if (row < 0) {
        hoverOn.set(withTiming(0, HOVER_FADE));
        return;
      }
      const y = MENU_PAD_V + row * ROW_HEIGHT;
      if (prev == null || prev < 0) {
        hoverY.set(y); // appear where the finger is
        hoverOn.set(withTiming(1, HOVER_FADE));
      } else {
        hoverY.set(withSpring(y, HOVER_SPRING));
      }
    },
    [submenuOpen],
  );
  const hoverStyle = useAnimatedStyle(() => ({
    opacity: hoverOn.value * HIGHLIGHT_OPACITY,
    transform: [{ translateY: hoverY.value }],
  }));

  // ── The submenu's selection: same hit-test, same travelling bubble ─────────
  // The drag that opened the submenu keeps reporting the finger (it's still the CARD's gesture); once
  // the submenu is up, THIS reaction hit-tests that finger into the submenu's rows and writes the same
  // `hoveredRow`, so the hold flows seamlessly from the parent rows into the child ones. Geometry is
  // the same arithmetic as the parent menu (no measurement), offset past the submenu's header + divider
  // and its on-screen anchor. Assumes the (short) row area isn't scrolled — the same assumption the
  // parent menu makes; a long, scrolled list falls back to tapping, which still works.
  const submenuAnchorTop = submenuGeom?.anchorTop ?? 0;
  const submenuRowCount = openSubmenuSpec?.rows.length ?? 0;
  const submenuListH = submenuGeom?.listH ?? 0;
  useAnimatedReaction(
    () => {
      if (!submenuOpen) return -2; // parent hit-test owns `hoveredRow`; leave it be
      if (!holdActive.value || !holdArmed.value) return -1;
      const scale = minS.value + expand.value * (maxS.value - minS.value);
      const menuTop = topMin.value + expand.value * (topMax.value - topMin.value) + naturalH.value * scale + GAP;
      // The submenu card's on-screen top = the menu's top + the anchor row's offset + the up-shift it
      // took to stay on screen. Then past its own top padding + header row + divider to the first row.
      const cardTop = menuTop + submenuAnchorTop + submenuShift.value;
      const rowsTop = cardTop + MENU_PAD_V + ROW_HEIGHT + SUBMENU_DIVIDER_H;
      // Only while the finger is inside the visible row VIEWPORT — otherwise a finger over the header (or
      // below the last visible row) would still resolve to a row once the scroll offset is added in.
      const rel = holdY.value - rowsTop;
      if (rel < 0 || rel > submenuListH) return -1;
      // Add the scroll offset: a list scrolled down by S shows the row at content-position rel+S.
      const index = Math.floor((rel + submenuScrollY.value) / ROW_HEIGHT);
      return index >= 0 && index < submenuRowCount ? index : -1;
    },
    (row, prev) => {
      if (row === -2 || row === prev) return;
      hoveredRow.set(row);
      if (row >= 0) runOnJS(selectionTick)();
    },
    [submenuOpen, submenuAnchorTop, submenuRowCount, submenuListH],
  );

  // The submenu's ONE travelling bubble — identical object to the parent's. Row-RELATIVE, because it
  // now lives inside the scroll content (see SubmenuSurface): translateY is just row*ROW_HEIGHT and the
  // scroll carries it, so a scrolled list keeps the highlight glued to its row.
  const subHoverY = useSharedValue(0);
  const subHoverOn = useSharedValue(0);
  useAnimatedReaction(
    () => (submenuOpen ? hoveredRow.value : -1),
    (row, prev) => {
      if (row === prev) return;
      if (row < 0) {
        subHoverOn.set(withTiming(0, HOVER_FADE));
        return;
      }
      const y = row * ROW_HEIGHT;
      if (prev == null || prev < 0) {
        subHoverY.set(y);
        subHoverOn.set(withTiming(1, HOVER_FADE));
      } else {
        subHoverY.set(withSpring(y, HOVER_SPRING));
      }
    },
    [submenuOpen],
  );
  const submenuHoverStyle = useAnimatedStyle(() => ({
    opacity: subHoverOn.value * HIGHLIGHT_OPACITY,
    transform: [{ translateY: subHoverY.value }],
  }));

  // ── Peek, started ON the menu ─────────────────────────────────────────────
  // The peek above rides the ORIGINAL long-press — the finger that opened the popup, still down. But
  // that's one specific way in, and it expires the moment you let go: after that the menu was taps only,
  // and pressing a row and sliding did nothing. So the same behaviour is offered a second way in — hold
  // a row, then slide — which is the same gesture, just begun later.
  //
  // A Pan-after-long-press, exactly as on the card, and for exactly the same reason: it keeps the finger
  // afterwards, so the hold flows into the slide without a release in between. The delay is what keeps
  // it out of everyone else's way — a quick tap is still a tap, and a quick drag still belongs to the
  // resize pan on the root (which this cancels when it activates, being the deeper handler).
  //
  // ARMED IMMEDIATELY, unlike the card's. The arming distance exists because a hold that BEGAN on a card
  // is a hold on nothing in particular — it must not commit whatever row happens to land under a
  // motionless thumb. A hold that began on a ROW is already a deliberate choice of that row; requiring
  // you to then reach for it would be asking twice.
  const menuHold = useMemo(
    () =>
      Gesture.Pan()
        // Off while a submenu is expanded — a hold there would arm the PARENT's hit-test grid
        // against rows that are pushed back behind the submenu.
        .enabled(!submenuOpen)
        .activateAfterLongPress(MENU_HOLD_MS)
        .onStart((e) => {
          holdActive.set(true);
          holdArmed.set(true);
          holdX.set(e.absoluteX);
          holdY.set(e.absoluteY);
        })
        .onUpdate((e) => {
          holdX.set(e.absoluteX);
          holdY.set(e.absoluteY);
        })
        .onEnd(() => {
          const row = hoveredRow.value;
          holdActive.set(false);
          holdArmed.set(false);
          hoveredRow.set(-1);
          if (row >= 0) runOnJS(commitHoveredRow)(row);
        })
        .onFinalize(() => {
          holdActive.set(false);
          holdArmed.set(false);
          hoveredRow.set(-1);
        }),
    [submenuOpen],
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
            <AnimatedBlurView tint={menuTint} experimentalBlurMethod={ANDROID_BLUR} animatedProps={backdropBlurProps} style={StyleSheet.absoluteFill} />
            <Animated.View
              style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP_TINT[menuTint] }, backdropTintStyle]}
            />
          </View>
        </GestureDetector>

      {/* Panel background + content — fades in at the final position. `box-none` so taps fall through
          to the dismiss backdrop while the page rail's FlatList still receives touches. The cover slot
          is a transparent placeholder; the real cover is the morphing layer below. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.panelWrap, { width: panelW }, panelStyle]}>
        <Animated.View style={[styles.panel, { backgroundColor: theme.backgroundPanel }, parentDimStyle]}>
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
              {/* While loading, the slots reserve their EXPECTED space (meta line + the remembered
                  description height) so an uncached open lands near its final size; once loaded they
                  collapse to the real content — an absent meta/description leaves no dead reserve,
                  and any difference from the assumption springs via the panel's content geometry. */}
              {detailLoaded ? (
                metaLine ? (
                  <View style={styles.metaSlot}>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {metaLine}
                    </ThemedText>
                  </View>
                ) : null
              ) : (
                <View style={styles.metaSlot}>
                  <Skeleton style={styles.metaSkeleton} />
                </View>
              )}
              {detailLoaded ? (
                detail.data?.description ? (
                  // Intrinsic height (≤ DESC_LINES lines), measured into the rolling assumption so
                  // the NEXT popup opens at this size.
                  <View
                    onLayout={(e) => {
                      lastDescHeight = Math.round(e.nativeEvent.layout.height);
                    }}>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={DESC_LINES}>
                      {detail.data.description}
                    </ThemedText>
                  </View>
                ) : null
              ) : assumedDescH > 0 ? (
                // Clipped to the assumed height, so a 1-line memory shows one skeleton line, not 3.
                <View style={{ height: assumedDescH, overflow: 'hidden' }}>
                  <View style={styles.descSkeleton}>
                    <Skeleton style={styles.descLine} />
                    <Skeleton style={styles.descLine} />
                    <Skeleton style={[styles.descLine, styles.descLineShort]} />
                  </View>
                </View>
              ) : null}
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
        <Animated.View
          pointerEvents="none"
          style={[styles.coverLayer, { width: COVER_W, height: coverH }, coverStyle, parentDimStyle]}>
          <Animated.View style={[styles.coverInner, coverRadiusStyle]}>
            {entry.cover ? (
              <Image
                source={{ uri: entry.cover }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                // Hold the morph until the bitmap is on screen (see `openMorph`); on error, open anyway
                // rather than wait out the fallback.
                onLoad={openMorph}
                onError={openMorph}
              />
            ) : null}
          </Animated.View>
        </Animated.View>
      </View>

      {/* The actions menu — the shared frosted surface (context-menu-material.tsx). It is never
          dragged: its position is DERIVED from the panel's live height (see menuStyle), so it tracks
          the panel's bottom edge as the pan resizes it, and eases with it when late content changes
          the panel's natural height. */}
      <GestureDetector gesture={menuHold}>
        <Animated.View style={[menuStyles.menuWrap, { width: menuW }, menuStyle]}>
          {/* The parent surface, pushed back (scaled + dimmed) while a submenu is expanded over it.
              Inert then too — the submenu is the only interactive layer until it collapses. */}
          <Animated.View pointerEvents={submenuOpen ? 'none' : 'auto'} style={parentMenuPushStyle}>
            <MenuSurface tint={menuTint} rows={rows} channel={{ holdActive, hoveredRow }} hoverStyle={hoverStyle} />
          </Animated.View>
          {/* Tap-catcher over the pushed-back parent while the submenu is up: a tap on the faded rows
              collapses the submenu (see tapCollapse) rather than falling through to the backdrop's
              dismiss-all. Declared BEFORE the submenu card so it sits UNDER it — the submenu keeps its
              own taps; only the exposed parent area collapses. */}
          {submenuOpen && (
            <GestureDetector gesture={tapCollapse}>
              <View style={StyleSheet.absoluteFill} />
            </GestureDetector>
          )}
          {/* The expanded submenu card, anchored at the row that opened it (same transformed
              container as the menu, so it tracks the menu's position for free). */}
          {submenuGeom && openSubmenuSpec && (
            <Animated.View style={[styles.submenuWrap, { width: menuW, top: submenuGeom.anchorTop }, submenuOuterStyle]}>
              {/* The clip layer: its height animates to unfold the full-size surface out of the header. */}
              <Animated.View style={[styles.submenuClip, submenuClipStyle]}>
                <SubmenuSurface
                  tint={menuTint}
                  spec={openSubmenuSpec}
                  listHeight={submenuGeom.listH}
                  onCollapse={collapseSubmenu}
                  channel={{ holdActive, hoveredRow }}
                  hoverStyle={submenuHoverStyle}
                  scrollY={submenuScrollY}
                />
              </Animated.View>
            </Animated.View>
          )}
        </Animated.View>
      </GestureDetector>
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

// `MenuRowSpec` / `MenuRow` (and the "NO theme.accent IN THIS MENU" rule that governs them) moved to
// `context-menu-material.tsx`, shared with the generic ContextMenuHost.

const styles = StyleSheet.create({
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
  // The expanded submenu card: absolutely placed inside the menu's transformed container at the
  // opening row's slot (`top` set inline), blooming from its top edge; may extend past the parent
  // menu's bounds, which is why the shadow/radius live here rather than being inherited.
  submenuWrap: {
    position: 'absolute',
    left: 0,
    borderRadius: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  // The reveal clipper (see submenuClipStyle): rounded + overflow-hidden so the full-size surface shows
  // through only up to the animated height, unfolding out of the header. Shadow stays on the wrap above
  // it (a view with overflow-hidden can't cast one).
  submenuClip: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
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
  // menuWrap / menu / hoverBubble / row styles live in `context-menu-material.tsx` (menuStyles).
});
