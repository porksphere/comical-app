import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps } from 'expo-router/ui';
import {
  Activity,
  History,
  LayoutGrid,
  Library,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
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

  const triggers = TABS.map((tab) => (
    <TabTrigger key={tab.name} name={tab.name} href={tab.href as never} asChild>
      <TabButton mobile={isMobile} Icon={tab.Icon}>
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
          <View style={StyleSheet.flatten([styles.topNav, { top: insets.top + Spacing.three }])}>
            {triggers}
          </View>
        </TabList>
      )}

      {isMobile && (
        <TabList style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
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
  ...props
}: TabTriggerSlotProps & { mobile?: boolean; Icon: LucideIcon }) {
  const theme = useTheme();

  if (mobile) {
    const color = isFocused ? ACTIVE : INACTIVE;
    return (
      <Pressable {...props} style={styles.bottomButton}>
        <Icon size={24} color={color} strokeWidth={2} />
        <Text style={[styles.bottomLabel, { color }]} numberOfLines={1}>
          {children}
        </Text>
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
    right: Spacing.four,
    height: 44, // matches the selector bar's subtitle line-height
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
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  bottomButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.one,
  },
  bottomLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});
