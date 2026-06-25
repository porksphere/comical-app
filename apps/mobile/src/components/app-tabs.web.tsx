import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps } from 'expo-router/ui';
import {
  Activity,
  History,
  LayoutGrid,
  Library,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';

// Web nav (Metro resolves this `.web` file for the web bundle, so native
// NativeTabs are never imported here). Responsive: an app-like black icon
// bottom bar on phones, a top nav bar on wider/desktop viewports.
//
// Note: the background/styling lives on `TabList` itself (which merges the
// `style` prop) rather than on an `asChild` wrapper — `asChild` drops the
// child View's background through its slot merge.
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
  const isMobile = width < MOBILE_BREAKPOINT;

  const triggers = TABS.map((tab) => (
    <TabTrigger key={tab.name} name={tab.name} href={tab.href as never} asChild>
      <TabButton mobile={isMobile} Icon={tab.Icon}>
        {tab.label}
      </TabButton>
    </TabTrigger>
  ));

  return (
    <Tabs style={styles.tabs}>
      {!isMobile && (
        <View style={styles.topBarContainer}>
          <ThemedView type="backgroundElement" style={styles.topBarInner}>
            <ThemedText type="smallBold" style={styles.brand}>
              Comical
            </ThemedText>
            <TabList asChild>
              <View style={styles.topTriggers}>{triggers}</View>
            </TabList>
          </ThemedView>
        </View>
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
  // --- Desktop top bar (floating pill) ---
  topBarContainer: {
    position: 'absolute',
    top: 0,
    width: '100%',
    padding: Spacing.three,
    flexDirection: 'row',
    justifyContent: 'center',
    zIndex: 1,
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexGrow: 1,
    maxWidth: MaxContentWidth,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
  },
  topTriggers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
