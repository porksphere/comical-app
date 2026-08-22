import { Tabs, TabList, TabTrigger, TabTriggerSlotProps } from 'expo-router/ui';
import { Bell, History, LayoutGrid, Library, Settings, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityTabBadge, SettingsTabBadge } from '@/components/tab-badge';
import { CrossfadeTabSlot } from '@/components/tab-slot-crossfade';
import { DesktopTopBarHeight, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { scrollToTopFor } from '@/lib/reselect-scroll';
import { useSeriesReaderBackdropDimStyle, useSeriesReaderBackdropStyle } from '@/lib/series-backdrop';
import { notifyScrollActivity, subscribeScrollPhase } from '@/lib/scroll-release';
import { COMMIT_DISTANCE, dismissThreshold, SETTLE_MS, TOP_GUARD } from '@/lib/slide-step';
import {
  getTabBarHideOffset,
  setTabBarHideOffset,
  tabBarHideOffset,
  tabBarProgress,
} from '@/lib/tab-bar-slide';
import { isTabBarPinned, subscribeTabBarPinned } from '@/lib/tab-bar-visibility';

// A custom-rendered bar on every platform (no OS-native tab bar) — responsive: an app-like black
// icon bottom bar on phones; on wider/desktop viewports a compact icon-only row pinned to the
// top-right, sitting on the same line as the Browse screen's bridge/page selector bar (so there's
// no separate nav bar).
const TABS: { name: string; href: string; label: string; Icon: LucideIcon }[] = [
  { name: 'browse', href: '/', label: 'Browse', Icon: LayoutGrid },
  { name: 'library', href: '/library', label: 'Library', Icon: Library },
  { name: 'history', href: '/history', label: 'History', Icon: History },
  { name: 'activity', href: '/activity', label: 'Activity', Icon: Bell },
  { name: 'settings', href: '/settings', label: 'Settings', Icon: Settings },
];

const MOBILE_BREAKPOINT = 768;

// Each desktop nav icon is a 22px Icon inside `iconButton`'s Spacing.one (4px) padding on every
// side, laid out in `topNav`'s Spacing.three (16px) gap — see the styles below. Kept as a formula
// (not a guessed constant) so a screen's own trailing header controls can reserve exactly enough
// room to clear this row on wide/desktop web, rather than drifting out of sync with a hardcoded
// pixel value the way index.tsx's old `searchPillWrap.marginRight` did (verified too narrow —
// left only ~14px clearance — when the same gap was needed for TabTitleBar's `right` slot).
const DESKTOP_NAV_ICON_SIZE = 22 + Spacing.one * 2;
export const DesktopNavWidth = TABS.length * DESKTOP_NAV_ICON_SIZE + (TABS.length - 1) * Spacing.three;

// Rounding slack for "is this offset at the content end?" — see the bounce guard in the scroll
// listener below.
const OVERSCROLL_SLOP = 1;
// Faded (not gone): a faint ghost that still reads as "the nav is here, scroll up
// to bring it back" while letting content show through.
const FADED_OPACITY = 0.2;

// react-native-web maps these onto the underlying div so the opacity change
// eases; they aren't part of RN's ViewStyle, hence the cast. Web only - no scroll-driven fade
// exists on native, so there's nothing to animate there.
//
// Borrows the sliding bars' `SETTLE_MS` and curve (`cubic-bezier` here is `settleEase` — cubic
// ease-out — since CSS can't take the function). Different animation, same commit: this fades while
// the top bar slides, but they fire off the same release, so a slower or softer-starting curve here
// just reads as the two bars disagreeing about when the gesture ended. It used to be 320ms `ease`,
// which both lagged the slide and eased IN — the visible pause after letting go.
const FADE_TRANSITION = {
  transitionProperty: 'opacity',
  transitionDuration: `${SETTLE_MS}ms`,
  transitionTimingFunction: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
} as unknown as ViewStyle;

/**
 * Web mobile only: fade the bottom nav out when a downward scroll is RELEASED, and back in on a
 * deliberate upward scroll (`COMMIT_DISTANCE`), on reaching the top, or via `reveal()` (wired to
 * bar interaction). Returns `false`/no-op when `enabled` is false (desktop, or any native platform
 * - the bar is always shown there), so the desktop top-nav is never affected.
 *
 * Same commit-on-release rule as the sliding bars, off the same `COMMIT_DISTANCE` of upward scroll
 * (`settleStep` / `scroll-release`) — reduced to two states because this bar fades rather than
 * slides, so there's no partial position to track. The hide waits for the gesture to end all the
 * same, which keeps the bar from flickering off at the first stray pixel, and lands the fade AFTER
 * the browser's own bottom chrome has collapsed and dropped our bar to the new viewport bottom,
 * rather than fighting that reposition mid-gesture.
 *
 * A capture-phase scroll listener is used because react-native-web scrolls an
 * inner `<div>` (the active screen's FlatList), not the window — capture catches
 * those non-bubbling events from any scroller. Per-element bookkeeping keyed on
 * the event target ignores the horizontal rails (their `scrollTop` never moves)
 * and tolerates switching between tab screens.
 */
function useAutoHideBottomBar(enabled: boolean) {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  // Upward px earned in the current gesture, exactly as the sliding bars count it: any downward
  // scroll spends it back to zero, and it's spent again once the gesture is over, so every reveal
  // earns the distance rather than adding up across separate flicks.
  const up = useRef(COMMIT_DISTANCE);
  // Last reported scroll offset, for the same dismissal threshold the sliding bars commit on — a
  // fade has no partial state, so here it reduces to refusing to hide at all until the content has
  // carried the bar past it. Shared (`dismissThreshold`) rather than the bar's own measured height,
  // which is what had this fade disagreeing with the two native slides about the same scroll.
  const lastY = useRef(0);
  const set = useCallback((next: boolean) => {
    // A pinned screen (Settings) keeps the bar whatever its content does — the web half of the same
    // guarantee `setTabBarProgress` gives the native slide.
    if (next && isTabBarPinned()) return;
    if (next && lastY.current < dismissThreshold(getTabBarHideOffset())) return;
    if (hiddenRef.current === next) return;
    hiddenRef.current = next;
    setHidden(next);
  }, []);
  const reveal = useCallback(() => {
    up.current = COMMIT_DISTANCE;
    set(false);
  }, [set]);

  // Taking the pin brings the bar straight back, so arriving on a pinned screen from one that had
  // faded it doesn't strand it as a ghost until something is scrolled. (Dropping it needs nothing:
  // the bar is simply free to fade again on the next downward scroll.)
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web') return;
    if (isTabBarPinned()) reveal();
    return subscribeTabBarPinned((pinned) => {
      if (pinned) reveal();
    });
  }, [enabled, reveal]);

  // Commit when the gesture ends: an earned reveal and a dismissal both land at `release`; anything
  // in between waits for `rest`, so an upward fling's momentum can still earn it.
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web') return;
    return subscribeScrollPhase((phase) => {
      if (phase === 'begin') return;
      const earned = up.current >= COMMIT_DISTANCE;
      if (earned || up.current === 0) {
        up.current = earned ? COMMIT_DISTANCE : 0;
        set(!earned);
        return;
      }
      if (phase === 'rest') {
        up.current = 0;
        set(true);
      }
    });
  }, [enabled, set]);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const positions = new WeakMap<object, number>();
    const onScroll = (e: Event) => {
      const target = e.target as (HTMLElement & EventTarget) | Document | null;
      let y: number;
      let maxY: number;
      let key: object;
      if (
        !target ||
        target === document ||
        target === document.scrollingElement ||
        target === document.documentElement ||
        target === document.body
      ) {
        y = window.scrollY;
        maxY = document.documentElement.scrollHeight - window.innerHeight;
        key = document;
      } else if (typeof (target as HTMLElement).scrollTop === 'number') {
        y = (target as HTMLElement).scrollTop;
        maxY = (target as HTMLElement).scrollHeight - (target as HTMLElement).clientHeight;
        key = target;
      } else {
        return;
      }
      const dy = y - (positions.get(key) ?? 0);
      positions.set(key, y);
      if (dy === 0) return; // horizontal rail, or no vertical movement
      lastY.current = y;
      // A wheel/trackpad emits no drag events at all, so this is also what keeps the release
      // detector's idle fallback ticking for the DOM-driven path.
      notifyScrollActivity();
      if (y <= TOP_GUARD) {
        // Pinned at the top: shown, with nothing left to earn. Checked BEFORE the bounce guard
        // below, so a viewport-sized page (top and content end being the same place) still resolves
        // as "at the top, bar shown" rather than sitting out every event it ever reports.
        up.current = COMMIT_DISTANCE;
        set(false);
        return;
      }
      // The sliding bars' bottom-bounce guard (`slide-step`), in DOM terms: at or past the content
      // end, iOS Safari's rubber band keeps reporting offsets, and its springback reports them
      // DECREASING — which is exactly the upward scroll that earns a reveal. Stretching a list
      // that's already at its end would otherwise pop the bar back out. `scrollHeight`/`clientHeight`
      // are integers while `scrollTop` isn't, hence the pixel of slop.
      if (y >= maxY - OVERSCROLL_SLOP) return;
      if (dy > 0) {
        up.current = 0;
      } else {
        up.current = Math.min(COMMIT_DISTANCE, up.current - dy);
        // Unlike the sliding bars there's no partial state to hold, so an earned reveal shows the
        // bar the moment it's earned rather than waiting for the release that only confirms it.
        if (up.current >= COMMIT_DISTANCE) set(false);
      }
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('scroll', onScroll, opts);
    return () => window.removeEventListener('scroll', onScroll, opts);
  }, [enabled, set]);

  return { hidden: enabled && hidden, reveal };
}

// Slack added onto the bar's measured height when publishing its hide offset, so the top hairline
// can't peek back in on a subpixel rounding. The offset itself lives in `tab-bar-visibility`
// (setTabBarHideOffset below) — it used to be an exported padded constant (120), but sliding
// further than the bar is tall is exactly what made a scroll-up feel dead until the invisible
// overshoot was walked back.
const HIDE_OFFSET_SLACK = 2;

/**
 * The tab screens the navigator is built from — the `TabList` expo-router discovers routes through
 * (a `TabTrigger` needs an `href` and a `TabList` parent to register a screen; see `Tabs.js`'s
 * `parseTriggersFromChildren`). Rendered, but with no UI of its own: the bar you actually see is a
 * sibling of this, built from href-less `TabTrigger`s that address the same routes by name.
 *
 * That split is what lets the bar be an `Animated.View` and carry a worklet-driven transform, which
 * a `TabList` cannot: it renders a plain `View`, and `asChild` routes through a Slot that flattens
 * and object-spreads the style, destroying an animated style outright. This is the structure Expo
 * documents for a custom tab bar — a hidden configuration `TabList` plus your own chrome — and it
 * keeps `<Tabs>` itself, and everything it sets up, exactly as it was.
 *
 * `display: 'none'` rather than not rendering it at all: the triggers must be in the tree for the
 * navigator to build its screens from.
 */
export default function AppTabs() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  // Static web export (`web.output: "static"`) prerenders every route on the
  // server, where there's no viewport so `width` is 0 — i.e. the server always
  // emits the mobile layout. A desktop client, however, sees its real width on
  // the very first render and would emit the desktop layout, producing a
  // hydration mismatch that crashes the `Tabs` navigator and leaves a white
  // screen. Gate the responsive switch behind a post-mount flag so the first
  // client render matches the server (mobile), then flip to the real layout as
  // an ordinary re-render once hydration is done. No-op on native (no SSR), but
  // harmless there too - it just flips true on the first effect pass.
  const [hydrated, setHydrated] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the point IS the post-hydration render: React's own remedy for an SSR mismatch, and the cascade is the fix rather than a cost.
  useEffect(() => setHydrated(true), []);
  const isMobile = !hydrated || width < MOBILE_BREAKPOINT;

  // Fade the mobile bottom bar away while scrolling down (web only - see hook);
  // bringing it back on upward scroll, at the top, or when a tab is touched (`reveal`).
  const { hidden, reveal } = useAutoHideBottomBar(isMobile);
  // How far the slide travels: the bar's own measured height (+ slack), so progress 1 puts its top
  // edge exactly at the screen edge — no invisible overshoot for a scroll-up to walk back before the
  // bar visibly rises. Published to `tab-bar-slide` as a shared value, since everything that turns
  // progress back into pixels reads it from a worklet now (the transform below, the scroll
  // reaction's 1:1 span) as well as from JS (the long-press overlay's chrome band).
  const onBarLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    setTabBarHideOffset(Math.ceil(e.nativeEvent.layout.height) + HIDE_OFFSET_SLACK);
  }, []);

  // Native only: slide the whole bar off-screen as the screen scrolls down, back in as it scrolls up,
  // tracking the finger 1:1 (X/Twitter-style) rather than flipping between two states. Read straight
  // off the shared value on the UI thread — no store subscription, no state, and so no render on the
  // frames the bar moves. `tabBarProgress` stays 0 on web, where the opacity fade above hides it
  // instead, and while a desktop viewport shows the top nav there is no bar mounted to move.
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: tabBarProgress.value * tabBarHideOffset.value }],
  }));

  // Pin the desktop nav to the right edge of the constrained content (the same
  // MaxTopLevelWidth the views centre within), not the raw screen edge, so it
  // lines up with the Browse selector bar on wide viewports.
  const navRight = Math.max(0, (width - MaxTopLevelWidth) / 2) + Spacing.four;

  // The buttons actually drawn. No `href`: these address the routes registered by TAB_REGISTRATION,
  // which is what a `TabTrigger` outside a `TabList` is for. Memoized because they're the expensive
  // part of this tree and nothing about them changes while the bar slides.
  const triggers = useMemo(
    () =>
      TABS.map((tab) => (
        <TabTrigger key={tab.name} name={tab.name} asChild>
          <TabButton mobile={isMobile} Icon={tab.Icon} onInteract={reveal} routeName={tab.name}>
            {tab.label}
          </TabButton>
        </TabTrigger>
      )),
    [isMobile, reveal],
  );

  // See the wrapper below — both rest at identity/transparent unless the series page is open.
  const seriesReaderBackdropStyle = useSeriesReaderBackdropStyle();
  const seriesReaderBackdropDim = useSeriesReaderBackdropDimStyle();

  return (
    // The tabs are what the series page usually opens OVER, and a transparent modal can't scale
    // or dim its backdrop the way a native presentation does — so the page drives it from here
    // instead (see lib/series-backdrop.ts). With no series page open the transform is identity and
    // the dim fully transparent, so this costs nothing at rest.
    <Animated.View style={[styles.tabs, seriesReaderBackdropStyle]}>
      <Tabs style={styles.tabs}>
        {/* Our own slot rather than expo-router's `TabSlot`: same screens, crossfaded instead of
            cut. The swap is not cosmetic — see `tab-slot-crossfade` for why the fade can't be layered
            on top of the stock one. */}
        <CrossfadeTabSlot style={styles.slot} />

        {/* Desktop: icon-only nav pinned to the top-right, aligned with the Browse selector bar row
            (top = its paddingTop, height = the subtitle line-height so the icons centre against the
            selectors). */}
        {!isMobile && <View style={[styles.topNav, { top: insets.top, right: navRight }]}>{triggers}</View>}

        {isMobile && (
          <Animated.View
            onLayout={onBarLayout}
            style={[
              styles.bottomBar,
              Platform.OS === 'web' && FADE_TRANSITION,
              {
                // The same flat, fully opaque `theme.background` every top bar paints (see
                // `BarSurface`) — the bar reads as the page continuing, not as a surface over it.
                // Content that scrolls behind it is simply hidden; this used to be a frosted
                // `BarBlur` it showed through.
                backgroundColor: theme.background,
                borderTopColor: theme.barHairline,
                paddingBottom: Math.max(insets.bottom, Spacing.two),
                // Web: fade to a faint ghost (still touchable, so tapping where it sits brings it
                // back) while scrolling down. Native: slide the whole bar down out of view instead
                // (`slideStyle`), continuously tracking scroll position X/Twitter-style. Either way
                // the bar is an absolute overlay (see styles.bottomBar), so screen content scrolls
                // behind it rather than being clipped by a dead strip — and, now that the bar is
                // opaque, is revealed by the bar getting out of the way.
                opacity: hidden ? FADED_OPACITY : 1,
                bottom: 0,
              },
              // Slide via transform (compositor) rather than animating `bottom` (layout), and via an
              // animated style rather than a re-render: the bar is repositioned on every scroll
              // frame. translateY > 0 pushes it down off-screen, by the bar's own measured height
              // (see onBarLayout) so it stops right at the edge.
              slideStyle,
            ]}>
            {triggers}
          </Animated.View>
        )}

        {/* Routes only, no UI — see the note above `AppTabs`. Inline, NOT extracted to a component:
            the discovery walk matches on `child.type === TabList` (and descends through Fragments
            and TabLists alone), so both a wrapping View and a wrapper component leave the navigator
            with zero screens — expo/expo#37796. The visible chrome above is an ordinary child,
            which that same walk simply skips. */}
        <TabList style={styles.registration}>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href as never} />
          ))}
        </TabList>
      </Tabs>
      {/* The dim under an open series page — inert (opacity 0) whenever none is, never interactive. */}
      <Animated.View pointerEvents="none" style={[styles.backdropDim, seriesReaderBackdropDim]} />
    </Animated.View>
  );
}

function TabButton({
  children,
  isFocused,
  mobile,
  Icon,
  onInteract,
  routeName,
  onPress,
  ...props
}: TabTriggerSlotProps & {
  mobile?: boolean;
  Icon: LucideIcon;
  onInteract?: () => void;
  routeName: string;
}) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();

  // Already on this tab: navigation is a no-op, so re-tapping it scrolls its
  // screen back to the top instead (there's no OS tab bar to give us this for
  // free anymore - see useScrollToTopOnReselect).
  const handlePress = (e: GestureResponderEvent) => {
    if (isFocused) scrollToTopFor(routeName);
    onPress?.(e);
  };

  if (mobile) {
    const color = isFocused ? theme.tabIconActive : theme.tabIconInactive;
    return (
      <Pressable
        {...props}
        testID={`tab.${routeName}`}
        onPress={handlePress}
        // Touching/hovering the (possibly faded) bar reveals it before the press
        // resolves, so a tap is never "lost" to an invisible target.
        onPressIn={onInteract}
        onHoverIn={onInteract}
        accessibilityLabel={typeof children === 'string' ? children : undefined}
        style={styles.bottomButton}>
        <View style={styles.iconWrap}>
          <Icon size={22} color={color} strokeWidth={2} />
          {routeName === 'activity' && <ActivityTabBadge />}
          {routeName === 'settings' && <SettingsTabBadge />}
        </View>
      </Pressable>
    );
  }

  // Desktop: icon only (no label), tinted with the theme so it reads on the
  // page background rather than a bar of its own.
  const color = isFocused ? theme.text : theme.textSecondary;
  return (
    <Pressable
      {...props}
      {...handlers}
      testID={`tab.${routeName}`}
      onPress={handlePress}
      accessibilityLabel={typeof children === 'string' ? children : undefined}
      style={({ pressed }) => [
        styles.iconButton,
        hovered && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <View style={styles.iconWrap}>
        <Icon size={22} color={color} strokeWidth={2.25} />
        {routeName === 'activity' && <ActivityTabBadge />}
        {routeName === 'settings' && <SettingsTabBadge />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flex: 1,
  },
  // The series page backdrop's dim (see the wrapper) — full-bleed, never interactive.
  backdropDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
  },
  slot: {
    flex: 1,
  },
  // The configuration TabList: present in the tree so the navigator can build its screens from the
  // triggers inside it, but never seen.
  registration: {
    display: 'none',
  },
  // --- Desktop top-right icon nav ---
  topNav: {
    position: 'absolute',
    // right is set inline so it tracks the constrained content edge.
    height: DesktopTopBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    zIndex: 10,
  },
  iconButton: {
    padding: Spacing.one,
    borderRadius: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
  // --- Mobile icon bottom bar ---
  // Painted the page's own `background` with a `barHairline` top edge (both set inline), exactly
  // like every top bar — so the bar reads as the page continuing, and that one line is the whole
  // of what marks it off.
  // Absolute overlay pinned to the bottom: content scrolls behind it (screens
  // reserve BottomTabInset so their last items clear it), so when it fades on
  // scroll the content stays visible through the ghost instead of being hidden
  // behind a reserved strip.
  bottomBar: {
    position: 'absolute',
    // Pinned to the bottom inline (bottom: 0); on native it slides off-screen via a transform
    // translateY driven by useNativeTabBarProgress.
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    // Spelled out because the bar is our own View now rather than a `TabList`, whose own style
    // supplied the row + distribution. The buttons are `flex: 1` so this changes nothing today; it's
    // here so the bar keeps its shape if one ever isn't.
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
  },
  // Positioning context for the badge pip overlaid on a tab icon.
  iconWrap: {
    position: 'relative',
  },
});
