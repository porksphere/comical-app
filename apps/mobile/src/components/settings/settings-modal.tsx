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
import { useEffect, useMemo, useState } from 'react';
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
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import {
  AboutIcon,
  BridgesIcon,
  ClearIcon,
  CustomPagesIcon,
  DiagnosticsIcon,
  DownloadsIcon,
  GeneralSettingsIcon,
  NotificationsIcon,
  RegistriesIcon,
  StorageIcon,
  TrackersIcon,
} from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { closeSettingsModal, setSettingsCategory, useSettingsModal } from '@/lib/settings-modal';
import { SettingsPaneContext, SettingsPaneNavContext, type PaneNav, type PaneParams } from '@/lib/settings-pane';

import AddRegistryScreen from '@/app/add-registry';
import BridgeSettingsScreen from '@/app/bridge-settings';
import CustomPageEditorScreen from '@/app/custom-page-editor';
import CustomSectionEditorScreen from '@/app/custom-section-editor';
import GestureTraceScreen from '@/app/gesture-trace';
import RegistryBrowseScreen from '@/app/registry-browse';
import SeriesDownloadsScreen from '@/app/series-downloads';
import TrackerSettingsScreen from '@/app/tracker-settings';
import WhatsNewScreen from '@/app/settings-whats-new';

/** Every screen the settings pane can push to. A push to anything NOT in here falls through to the
 *  router — which is how something that genuinely does leave settings still can. */
const SUB_PAGES: Record<string, () => React.ReactNode> = {
  '/bridge-settings': BridgeSettingsScreen,
  '/registries': RegistriesScreen,
  '/registry-browse': RegistryBrowseScreen,
  '/add-registry': AddRegistryScreen,
  '/custom-page-editor': CustomPageEditorScreen,
  '/custom-section-editor': CustomSectionEditorScreen,
  '/tracker-settings': TrackerSettingsScreen,
  '/downloads': DownloadsScreen,
  '/series-downloads': SeriesDownloadsScreen,
  '/gesture-trace': GestureTraceScreen,
  '/settings-whats-new': WhatsNewScreen,
};

/** The same categories, in the same order, with the same ICONS as the Settings tab's own list — this
 *  is a second way in to one set of screens, never a second set, so a row that reads differently in
 *  the two places is a bug rather than a variation. */
const CATEGORIES: { id: string; label: string; Icon: SettingsIcon; Screen: () => React.ReactNode }[] = [
  { id: 'general', label: 'General', Icon: GeneralSettingsIcon, Screen: GeneralScreen },
  { id: 'notifications', label: 'Notifications', Icon: NotificationsIcon, Screen: NotificationsScreen },
  { id: 'bridges', label: 'Bridges', Icon: BridgesIcon, Screen: BridgesScreen },
  { id: 'trackers', label: 'Trackers', Icon: TrackersIcon, Screen: TrackersScreen },
  { id: 'registries', label: 'Registries', Icon: RegistriesIcon, Screen: RegistriesScreen },
  { id: 'custom-pages', label: 'Custom pages', Icon: CustomPagesIcon, Screen: CustomPagesScreen },
  { id: 'downloads', label: 'Downloads', Icon: DownloadsIcon, Screen: DownloadsScreen },
  { id: 'storage', label: 'Storage', Icon: StorageIcon, Screen: StorageScreen },
  { id: 'diagnostics', label: 'Diagnostics', Icon: DiagnosticsIcon, Screen: DiagnosticsScreen },
  { id: 'about', label: 'About', Icon: AboutIcon, Screen: AboutScreen },
];

type SettingsIcon = (props: { color: string; size?: number }) => React.ReactNode;

export function SettingsModal() {
  const theme = useTheme();
  const { open, category } = useSettingsModal();
  const current = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0]!;
  // Sub-pages pushed from within the pane. A stack, not a single slot: bridges → registries →
  // registry-browse is three deep, and each step has to come back to the one before it.
  const [stack, setStack] = useState<{ pathname: string; params: PaneParams }[]>([]);
  const top = stack[stack.length - 1];

  const nav = useMemo<PaneNav>(
    () => ({
      push: (pathname, params) => {
        if (!SUB_PAGES[pathname]) return false;
        setStack((s) => [...s, { pathname, params }]);
        return true;
      },
      back: () => {
        let popped = false;
        setStack((s) => {
          popped = s.length > 0;
          return s.slice(0, -1);
        });
        return popped;
      },
      params: top?.params ?? {},
    }),
    [top],
  );

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
                <CategoryRow key={c.id} id={c.id} label={c.label} Icon={c.Icon} active={c.id === current.id} />
              ))}
            </ScrollView>
          </View>
          <View style={styles.pane}>
            {/* No header bar. The category list already names what you're looking at, so a title over
                the pane only repeated it — and a bar is what this modal exists to get away from.
                Close floats in the corner instead, over the pane rather than above it. */}
            {/* Keyed so switching category remounts the screen rather than handing the next one the
                previous one's state — these are route components, written expecting a fresh mount. */}
            <View style={styles.paneBody} key={top ? `${stack.length}:${top.pathname}` : current.id}>
              <SettingsPaneContext.Provider value={true}>
                <SettingsPaneNavContext.Provider value={nav}>
                  {top ? <SubPage pathname={top.pathname} /> : <current.Screen />}
                </SettingsPaneNavContext.Provider>
              </SettingsPaneContext.Provider>
            </View>
            {top ? (
              <View style={styles.backFloat}>
                <PaneBackButton onPress={() => setStack((s) => s.slice(0, -1))} />
              </View>
            ) : null}
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

function SubPage({ pathname }: { pathname: string }) {
  const Screen = SUB_PAGES[pathname];
  return Screen ? <Screen /> : null;
}

/** The pane's own back. The pushed screen's `TopBar` is suppressed in here, so this is the only way
 *  out of a sub-page — mirrored against the close, in the corner content runs under. */
function PaneBackButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      {...handlers}
      testID="settings.modal.back"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={[styles.close, { backgroundColor: hovered ? theme.backgroundElement : 'transparent' }]}>
      <ChevronLeftIcon color={theme.textSecondary} size={18} />
    </Pressable>
  );
}

function CategoryRow({
  id,
  label,
  Icon,
  active,
}: {
  id: string;
  label: string;
  Icon: SettingsIcon;
  active: boolean;
}) {
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
      <Icon color={active ? theme.text : theme.textSecondary} size={20} />
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
  backFloat: {
    position: 'absolute',
    top: Spacing.half,
    left: Spacing.half,
  },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 36,
    paddingHorizontal: Spacing.two,
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
