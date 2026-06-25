import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';

// Web nav (Metro resolves this `.web` file for the web bundle, so native
// NativeTabs are never imported here). Responsive: a bottom tab bar on phones,
// a top nav bar on wider/desktop viewports.
const TABS: { name: string; href: string; label: string }[] = [
  { name: 'browse', href: '/', label: 'Browse' },
  { name: 'library', href: '/library', label: 'Library' },
  { name: 'history', href: '/history', label: 'History' },
  { name: 'activity', href: '/activity', label: 'Activity' },
  { name: 'settings', href: '/settings', label: 'Settings' },
];

const MOBILE_BREAKPOINT = 768;

export default function AppTabs() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isMobile = width < MOBILE_BREAKPOINT;

  const triggers = TABS.map((tab) => (
    <TabTrigger key={tab.name} name={tab.name} href={tab.href as never} asChild>
      <TabButton mobile={isMobile}>{tab.label}</TabButton>
    </TabTrigger>
  ));

  return (
    <Tabs style={styles.tabs}>
      {!isMobile && (
        <TabList asChild>
          <View style={styles.topBarContainer}>
            <ThemedView type="backgroundElement" style={styles.topBarInner}>
              <ThemedText type="smallBold" style={styles.brand}>
                Comical
              </ThemedText>
              {triggers}
            </ThemedView>
          </View>
        </TabList>
      )}

      <TabSlot style={styles.slot} />

      {isMobile && (
        <TabList asChild>
          <ThemedView
            type="backgroundElement"
            style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
            {triggers}
          </ThemedView>
        </TabList>
      )}
    </Tabs>
  );
}

function TabButton({
  children,
  isFocused,
  mobile,
  ...props
}: TabTriggerSlotProps & { mobile?: boolean }) {
  if (mobile) {
    return (
      <Pressable {...props} style={styles.bottomButton}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
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
  // --- Mobile bottom bar ---
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.25)',
  },
  bottomButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one,
  },
});
