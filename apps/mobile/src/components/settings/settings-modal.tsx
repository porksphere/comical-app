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
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

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

  return (
    // `Modal` rather than an absolutely-positioned View: it renders above everything without this
    // component having to win a z-index argument with the toasts, the context menus and the series
    // page's own overlay, and it gives Escape-to-close for free on web.
    <Modal visible={open} transparent animationType="fade" onRequestClose={closeSettingsModal}>
      <View style={styles.scrim}>
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
            {/* Close lives on the category column's heading row — where a title bar would have been,
                and the one place in the panel with room. Floating it over the pane put it on top of
                the first row's own control. */}
            <View style={styles.heading}>
              <ThemedText type="smallBold">Settings</ThemedText>
              <CloseButton />
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
          </View>
        </View>
      </View>
    </Modal>
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
      <ClearIcon color={theme.textSecondary} size={18} />
    </Pressable>
  );
}

const CATEGORY_WIDTH = 200;

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
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
    justifyContent: 'space-between',
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingBottom: Spacing.two,
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
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
  },
});
