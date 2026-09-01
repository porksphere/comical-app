/**
 * Settings as a modal with its own two panes — categories on the left, the chosen one on the right.
 *
 * WEB ONLY, and it exists because a settings screen is not a destination: it's a place you go, do
 * one thing, and leave. As a pushed route it covered the whole window, took the rail with it, and
 * made you navigate back out. As a modal it sits over whatever you were doing and hands it back.
 *
 * The panes are the real settings SCREENS, not copies. They're route components, so they take no
 * props — `SettingsPaneContext` is what tells their `TopBar` to stand down, which is the only thing
 * about them that has to differ in here.
 *
 * Native is untouched: nothing renders this, and the rail keeps its Settings row there.
 */
import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import AboutScreen from '@/app/settings-about';
import BridgesScreen from '@/app/bridges';
import CustomPagesScreen from '@/app/custom-pages';
import DiagnosticsScreen from '@/app/diagnostics';
import DownloadsScreen from '@/app/downloads';
import GeneralScreen from '@/app/settings-general';
import NotificationsScreen from '@/app/settings-notifications';
import RegistriesScreen from '@/app/registries';
import StorageScreen from '@/app/storage';
import TrackersScreen from '@/app/trackers';
import { ClearIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { closeSettingsModal, setSettingsCategory, useSettingsModal } from '@/lib/settings-modal';
import { SettingsPaneContext } from '@/lib/settings-pane';

/** The same categories, in the same order, as the Settings tab's own list — this is a second way in
 *  to one set of screens, never a second set. */
const CATEGORIES: { id: string; label: string; Screen: () => React.ReactNode }[] = [
  { id: 'general', label: 'General', Screen: GeneralScreen },
  { id: 'notifications', label: 'Notifications', Screen: NotificationsScreen },
  { id: 'bridges', label: 'Bridges', Screen: BridgesScreen },
  { id: 'trackers', label: 'Trackers', Screen: TrackersScreen },
  { id: 'registries', label: 'Registries', Screen: RegistriesScreen },
  { id: 'custom-pages', label: 'Custom pages', Screen: CustomPagesScreen },
  { id: 'downloads', label: 'Downloads', Screen: DownloadsScreen },
  { id: 'storage', label: 'Storage', Screen: StorageScreen },
  { id: 'diagnostics', label: 'Diagnostics', Screen: DiagnosticsScreen },
  { id: 'about', label: 'About', Screen: AboutScreen },
];

export function SettingsModal() {
  const theme = useTheme();
  const { open, category } = useSettingsModal();
  const current = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0]!;

  // `Modal` gave Escape for free; an in-tree panel has to ask for it.
  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettingsModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    // An absolutely-positioned View, NOT `Modal`. A `Modal` renders in a layer above the whole app
    // tree — including `OverlayProvider`, which sits at the root and paints its stack after its
    // children — so every selector opened from a settings row appeared UNDERNEATH this panel. In the
    // tree, the ordering comes out right on its own: the panel is inside the provider's children, so
    // the provider's overlays are painted over it, which is what a dropdown from a row in here
    // should do.
    <View style={styles.scrim} pointerEvents="auto">
        {/* BEHIND the panel, not around it: a scrim that wrapped the panel made one button the child
            of another, which is invalid HTML — the browser says so out loud — and made the whole
            dialog one press target for a screen reader. */}
        <Pressable
          testID="settings.modal.scrim"
          accessibilityLabel="Close settings"
          accessibilityRole="button"
          onPress={closeSettingsModal}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID="settings.modal.panel"
          style={[styles.panel, { backgroundColor: theme.background, borderColor: theme.barHairline }]}>
          <View style={[styles.categories, { borderRightColor: theme.barHairline }]}>
            <View style={styles.heading}>
              <ThemedText type="smallBold">Settings</ThemedText>
            </View>
            <ScrollView contentContainerStyle={styles.categoryList} showsVerticalScrollIndicator={false}>
              {CATEGORIES.map((c) => (
                <CategoryRow key={c.id} id={c.id} label={c.label} active={c.id === current.id} />
              ))}
            </ScrollView>
          </View>
          <View style={styles.pane}>
            {/* No header bar. The category list already names what you're looking at, so a title over
                the pane only repeated it — and a bar is what this modal exists to get away from.
                Close floats in the corner instead, over the pane rather than above it. */}
            {/* Keyed so switching category remounts the screen rather than handing the next one the
                previous one's state — these are route components, written expecting a fresh mount. */}
            <View style={styles.paneBody} key={current.id}>
              <SettingsPaneContext.Provider value={true}>
                <current.Screen />
              </SettingsPaneContext.Provider>
            </View>
            {/* Over the pane, in the corner a close belongs in. Nothing under it — no chip, no
                shadow: the rows it floats over are quiet enough that a bare glyph reads, and the
                content deliberately runs beneath it rather than being pushed down to clear it. */}
            <View style={styles.closeFloat}>
              <CloseButton />
            </View>
          </View>
        </View>
    </View>
  );
}

function CategoryRow({ id, label, active }: { id: string; label: string; active: boolean }) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      {...handlers}
      testID={`settings.modal.category.${id}`}
      onPress={() => setSettingsCategory(id)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[
        styles.categoryRow,
        { backgroundColor: active ? theme.backgroundSelected : hovered ? theme.backgroundElement : 'transparent' },
      ]}>
      <ThemedText numberOfLines={1} themeColor={active ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function CloseButton() {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      {...handlers}
      testID="settings.modal.close"
      onPress={closeSettingsModal}
      accessibilityRole="button"
      accessibilityLabel="Close settings"
      style={[styles.close, { backgroundColor: hovered ? theme.backgroundElement : 'transparent' }]}>
      <ClearIcon color={theme.textSecondary} size={16} />
    </Pressable>
  );
}

const CATEGORY_WIDTH = 200;

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: Spacing.five,
  },
  // The panel sits above the scrim's own press target purely by document order.
  panel: {
    flexDirection: 'row',
    // A hairline all the way round, not just the divider between the panes: on the dark theme the
    // panel is painted the same `background` as the page it floats over, so without an edge it read
    // as a hole rather than a surface. The scrim alone wasn't enough to separate them.
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: MaxContentWidth + CATEGORY_WIDTH,
    height: '100%',
    maxHeight: 640,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  categories: {
    width: CATEGORY_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  // Tucked right into the corner. Content runs beneath it by design, but at the pane's own inset it
  // landed exactly on the first row's chevron, which reads as a glyph drawn twice rather than a
  // control over a list.
  closeFloat: {
    position: 'absolute',
    top: Spacing.half,
    right: Spacing.half,
  },
  categoryList: {
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.half,
  },
  categoryRow: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  pane: {
    flex: 1,
  },
  paneBody: {
    flex: 1,
  },
  close: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
});
