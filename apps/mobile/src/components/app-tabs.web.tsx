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
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';

// Web nav (Metro resolves this `.web` file for the web bundle, so native
// NativeTabs are never imported here). Responsive: an app-like black icon
// bottom bar on phones, a top nav bar on wider/desktop viewports.
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
      {/* Desktop top bar. The `TabList` (with the triggers as its direct
          children) must be a direct child of `Tabs` — expo-router discovers the
          tab screens by walking `Tabs`' children through Fragments and TabLists
          only, never through arbitrary Views. Wrapping the TabList in layout
          Views hides the triggers and makes the navigator render zero screens
          (white screen). So the pill itself is the TabList (via `asChild`), and
          the brand sits alongside the triggers as a non-trigger child. */}
      {!isMobile && (
        <TabList asChild>
          <ThemedView type="backgroundElement" style={styles.topBar}>
            <ThemedText type="smallBold" style={styles.brand}>
              Comical
            </ThemedText>
            {triggers}
          </ThemedView>
        </TabList>
      )}

      <TabSlot style={styles.slot} />

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
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.topButton}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
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
  // --- Desktop top bar (centered pill) ---
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: Spacing.two,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    marginTop: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
  },
  brand: {
    marginRight: 'auto',
  },
  topButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  // --- Mobile black icon bottom bar ---
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#000000',
    paddingTop: Spacing.three,
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
