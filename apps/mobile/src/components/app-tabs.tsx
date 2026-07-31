import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps } from 'expo-router/ui';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarBlur } from '@/components/bar-blur';
import { ActivityTabBadge, SettingsTabBadge } from '@/components/tab-badge';
import { DesktopTopBarHeight, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { scrollToTopFor } from '@/lib/reselect-scroll';
import { notifyScrollActivity, subscribeScrollPhase } from '@/lib/scroll-release';
import { COMMIT_DISTANCE } from '@/lib/slide-step';
import {
  getTabBarHideOffset,
  getTabBarProgress,
  setTabBarHideOffset,
  subscribeTabBarProgress,
} from '@/lib/tab-bar-visibility';

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

const TOP_GUARD = 8;
// Faded (not gone): a faint ghost that still reads as "the nav is here, scroll up
// to bring it back" while letting content show through.
const FADED_OPACITY = 0.2;

// react-native-web maps these onto the underlying div so the opacity change
// eases; they aren't part of RN's ViewStyle, hence the cast. Web only - no scroll-driven fade
// exists on native, so there's nothing to animate there.
const FADE_TRANSITION = {
  transitionProperty: 'opacity',
  transitionDuration: '320ms',
  transitionTimingFunction: 'ease',
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
  // Last reported scroll offset, for the same "can't have travelled further than the content" rule
  // the sliding bars get from `hideCeiling` — a fade has no partial state, so here it reduces to
  // refusing to hide at all until the content has scrolled past the bar's own height.
  const lastY = useRef(0);
  const set = useCallback((next: boolean) => {
    if (next && lastY.current < getTabBarHideOffset()) return;
    if (hiddenRef.current === next) return;
    hiddenRef.current = next;
    setHidden(next);
  }, []);
  const reveal = useCallback(() => {
    up.current = COMMIT_DISTANCE;
    set(false);
  }, [set]);

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
      let key: object;
      if (
        !target ||
        target === document ||
        target === document.scrollingElement ||
        target === document.documentElement ||
        target === document.body
      ) {
        y = window.scrollY;
        key = document;
      } else if (typeof (target as HTMLElement).scrollTop === 'number') {
        y = (target as HTMLElement).scrollTop;
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
        // Pinned at the top: shown, with nothing left to earn.
        up.current = COMMIT_DISTANCE;
        set(false);
        return;
      }
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
 * Native only: tracks the bottom bar's hidden-ness continuously (0 shown → 1 fully
 * off-screen) as the focused screen scrolls, driven by the shared `tab-bar-visibility`
 * store that each tab screen reports into via `useHideTabBarOnScroll`. Plain state
 * rather than Reanimated because `expo-router/ui`'s `TabList` only exposes a plain
 * `style` prop — wrapping it to attach a worklet-driven animated style would either
 * break tab discovery (see `Tabs.js`'s Fragment/TabList-only recursion) or have its
 * style flattened away by the `asChild` Slot shim. Every scroll-reported frame moves
 * the bar in lockstep with the finger (X/Twitter-style), not a two-state flip.
 */
function useNativeTabBarProgress(enabled: boolean) {
  const [progress, setProgress] = useState(getTabBarProgress());

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    return subscribeTabBarProgress(setProgress);
  }, [enabled]);

  return enabled && Platform.OS !== 'web' ? progress : 0;
}

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
  useEffect(() => setHydrated(true), []);
  const isMobile = !hydrated || width < MOBILE_BREAKPOINT;

  // Fade the mobile bottom bar away while scrolling down (web only - see hook);
  // bringing it back on upward scroll, at the top, or when a tab is touched (`reveal`).
  const { hidden, reveal } = useAutoHideBottomBar(isMobile);
  // Native only: slide the whole bar off-screen as the screen scrolls down, back in as it scrolls up.
  const nativeProgress = useNativeTabBarProgress(isMobile);
  // How far that slide travels: the bar's own measured height (+ slack), so progress 1 puts its top
  // edge exactly at the screen edge — no invisible overshoot for a scroll-up to walk back before the
  // bar visibly rises. Published to `tab-bar-visibility` for everything else that converts the shared
  // progress to pixels (the scroll hook's 1:1 span, the long-press overlay's chrome band).
  const [hideOffset, setHideOffset] = useState(getTabBarHideOffset());
  const onBarLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const px = Math.ceil(e.nativeEvent.layout.height) + HIDE_OFFSET_SLACK;
    setHideOffset(px);
    setTabBarHideOffset(px);
  }, []);

  // Pin the desktop nav to the right edge of the constrained content (the same
  // MaxTopLevelWidth the views centre within), not the raw screen edge, so it
  // lines up with the Browse selector bar on wide viewports.
  const navRight = Math.max(0, (width - MaxTopLevelWidth) / 2) + Spacing.four;

  // Memoized so a scroll-driven `nativeProgress` change (which re-renders AppTabs every reported
  // frame while the bar slides) doesn't re-create these elements — with stable refs React skips
  // reconciling the trigger subtrees, leaving only the TabList's own (transform-only) style to
  // update. Without this, every frame of a fling re-rendered all five Pressables + icons.
  const triggers = useMemo(
    () =>
      TABS.map((tab) => (
        <TabTrigger key={tab.name} name={tab.name} href={tab.href as never} asChild>
          <TabButton mobile={isMobile} Icon={tab.Icon} onInteract={reveal} routeName={tab.name}>
            {tab.label}
          </TabButton>
        </TabTrigger>
      )),
    [isMobile, reveal],
  );

  return (
    <Tabs style={styles.tabs}>
      <TabSlot style={styles.slot} />

      {/* Desktop: icon-only nav pinned to the top-right, aligned with the
          Browse selector bar row (top = its paddingTop, height = the subtitle
          line-height so the icons centre against the selectors).

          The `TabList` (with the triggers as its direct children) must be a
          direct child of `Tabs` — expo-router discovers the tab screens by
          walking `Tabs`' children through Fragments and TabLists only, never
          through arbitrary Views, so wrapping it in layout Views would hide the
          triggers and leave the navigator with zero screens. Hence `asChild`
          with the positioned row as the single wrapper. */}
      {!isMobile && (
        <TabList asChild>
          {/* `<TabList asChild>` forwards via a Slot that rejects array styles
              on its child, so flatten the positioned style into one object. */}
          <View style={StyleSheet.flatten([styles.topNav, { top: insets.top, right: navRight }])}>
            {triggers}
          </View>
        </TabList>
      )}

      {isMobile && (
        <TabList
          // TabList spreads extra props onto its plain View, so onLayout reaches the real bar.
          onLayout={onBarLayout}
          style={[
            styles.bottomBar,
            Platform.OS === 'web' && FADE_TRANSITION,
            {
              borderTopColor: theme.tabBarBorder,
              paddingBottom: Math.max(insets.bottom, Spacing.two),
              // Web: fade to a faint ghost (still touchable, so tapping where it
              // sits brings it back) while scrolling down. Native: slide the whole
              // bar down out of view instead, continuously tracking scroll position
              // via `useNativeTabBarProgress` (X/Twitter-style). Either way the bar is
              // an absolute overlay (see styles.bottomBar), so screen content scrolls
              // behind it and stays visible rather than being clipped by a dead strip.
              opacity: hidden ? FADED_OPACITY : 1,
              // Slide via transform (compositor) rather than animating `bottom` (layout): the bar
              // is repositioned on every scroll-reported frame, so a translate avoids a native
              // layout pass each time. translateY > 0 pushes it down off-screen, by the bar's own
              // measured height (see onBarLayout) so it stops right at the edge. Native only —
              // nativeProgress is 0 on web, where the opacity fade above handles hiding instead.
              bottom: 0,
              transform: [{ translateY: hideOffset * nativeProgress }],
            },
          ]}>
          {/* Frosted background behind the icons (content scrolls under the bar). */}
          <BarBlur fallback={theme.tabBar} />
          {triggers}
        </TabList>
      )}
    </Tabs>
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
  slot: {
    flex: 1,
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
  // Its own shade (theme `tabBar`/`tabBarBorder`, set inline), distinct from both
  // the page background and general element surfaces — mirrors the reference's
  // `.bottom-nav` on dark and adapts to the light theme.
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
