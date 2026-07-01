import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps } from 'expo-router/ui';
import {
  Activity,
  History,
  LayoutGrid,
  Library,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DesktopTopBarHeight, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Web nav (Metro resolves this `.web` file for the web bundle, so native
// NativeTabs are never imported here). Responsive: an app-like black icon
// bottom bar on phones; on wider/desktop viewports a compact icon-only row
// pinned to the top-right, sitting on the same line as the Browse screen's
// bridge/page selector bar (so there's no separate nav bar).
const TABS: { name: string; href: string; label: string; Icon: LucideIcon }[] = [
  { name: 'browse', href: '/', label: 'Browse', Icon: LayoutGrid },
  { name: 'library', href: '/library', label: 'Library', Icon: Library },
  { name: 'history', href: '/history', label: 'History', Icon: History },
  { name: 'activity', href: '/activity', label: 'Activity', Icon: Activity },
  { name: 'settings', href: '/settings', label: 'Settings', Icon: Settings },
];

const MOBILE_BREAKPOINT = 768;
const ACTIVE = '#ffffff';
const INACTIVE = '#8E8E93';

// Mobile bottom-bar auto-hide thresholds (px of cumulative scroll in one
// direction). Hiding only after a chunk of downward scroll lets the fade land
// *after* the browser's own bottom chrome has collapsed and dropped our bar to
// the new viewport bottom, rather than fighting that reposition. Showing needs a
// smaller, deliberate upward scroll so the bar comes back readily.
const HIDE_AFTER = 72;
const SHOW_AFTER = 40;
const TOP_GUARD = 8;
// Faded (not gone): a faint ghost that still reads as "the nav is here, scroll up
// to bring it back" while letting content show through.
const FADED_OPACITY = 0.2;

// react-native-web maps these onto the underlying div so the opacity change
// eases; they aren't part of RN's ViewStyle, hence the cast.
const FADE_TRANSITION = {
  transitionProperty: 'opacity',
  transitionDuration: '320ms',
  transitionTimingFunction: 'ease',
} as unknown as ViewStyle;

/**
 * Web mobile only: fade the bottom nav out on sustained downward scroll, and
 * back in on a deliberate upward scroll, on reaching the top, or via `reveal()`
 * (wired to bar interaction). Returns `false`/no-op when `enabled` is false
 * (desktop), so the desktop top-nav is never affected.
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
  const set = useCallback((next: boolean) => {
    if (hiddenRef.current === next) return;
    hiddenRef.current = next;
    setHidden(next);
  }, []);
  const reveal = useCallback(() => set(false), [set]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const positions = new WeakMap<object, number>();
    let down = 0;
    let up = 0;
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
      if (y <= TOP_GUARD) {
        down = 0;
        set(false);
        return;
      }
      if (dy > 0) {
        down += dy;
        up = 0;
        if (down >= HIDE_AFTER) set(true);
      } else {
        up -= dy;
        down = 0;
        if (up >= SHOW_AFTER) set(false);
      }
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('scroll', onScroll, opts);
    return () => window.removeEventListener('scroll', onScroll, opts);
  }, [enabled, set]);

  return { hidden: enabled && hidden, reveal };
}

export default function AppTabs() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Static web export (`web.output: "static"`) prerenders every route on the
  // server, where there's no viewport so `width` is 0 — i.e. the server always
  // emits the mobile layout. A desktop client, however, sees its real width on
  // the very first render and would emit the desktop layout, producing a
  // hydration mismatch that crashes the `Tabs` navigator and leaves a white
  // screen. Gate the responsive switch behind a post-mount flag so the first
  // client render matches the server (mobile), then flip to the real layout as
  // an ordinary re-render once hydration is done.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const isMobile = !hydrated || width < MOBILE_BREAKPOINT;

  // Fade the mobile bottom bar away while scrolling down (see hook); bringing it
  // back on upward scroll, at the top, or when a tab is touched (`reveal`).
  const { hidden, reveal } = useAutoHideBottomBar(isMobile);

  // Pin the desktop nav to the right edge of the constrained content (the same
  // MaxTopLevelWidth the views centre within), not the raw screen edge, so it
  // lines up with the Browse selector bar on wide viewports.
  const navRight = Math.max(0, (width - MaxTopLevelWidth) / 2) + Spacing.four;

  const triggers = TABS.map((tab) => (
    <TabTrigger key={tab.name} name={tab.name} href={tab.href as never} asChild>
      <TabButton mobile={isMobile} Icon={tab.Icon} onInteract={reveal}>
        {tab.label}
      </TabButton>
    </TabTrigger>
  ));

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
          style={[
            styles.bottomBar,
            FADE_TRANSITION,
            // Fade to a faint ghost (still touchable, so tapping where it sits
            // brings it back) while scrolling down. The bar is an absolute overlay
            // (see styles.bottomBar), so screen content scrolls behind it and stays
            // visible through the ghost rather than being clipped by a dead strip.
            { paddingBottom: Math.max(insets.bottom, Spacing.two), opacity: hidden ? FADED_OPACITY : 1 },
          ]}>
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
  ...props
}: TabTriggerSlotProps & { mobile?: boolean; Icon: LucideIcon; onInteract?: () => void }) {
  const theme = useTheme();

  if (mobile) {
    const color = isFocused ? ACTIVE : INACTIVE;
    return (
      <Pressable
        {...props}
        // Touching/hovering the (possibly faded) bar reveals it before the press
        // resolves, so a tap is never "lost" to an invisible target.
        onPressIn={onInteract}
        onHoverIn={onInteract}
        accessibilityLabel={typeof children === 'string' ? children : undefined}
        style={styles.bottomButton}>
        <Icon size={22} color={color} strokeWidth={2} />
      </Pressable>
    );
  }

  // Desktop: icon only (no label), tinted with the theme so it reads on the
  // page background rather than a bar of its own.
  const color = isFocused ? theme.text : theme.textSecondary;
  return (
    <Pressable
      {...props}
      accessibilityLabel={typeof children === 'string' ? children : undefined}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Icon size={22} color={color} strokeWidth={2.25} />
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
  },
  pressed: {
    opacity: 0.6,
  },
  // --- Mobile black icon bottom bar ---
  // Reference: `.bottom-nav { background: #111113; border-top: 1px solid
  // #242427; }` — its own shade, distinct from both the page background
  // (#0f0f0f) and general element surfaces.
  // Absolute overlay pinned to the bottom: content scrolls behind it (screens
  // reserve BottomTabInset so their last items clear it), so when it fades on
  // scroll the content stays visible through the ghost instead of being hidden
  // behind a reserved strip.
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111113',
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#242427',
  },
  bottomButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
  },
});
