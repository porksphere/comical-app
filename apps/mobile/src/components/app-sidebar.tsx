/**
 * The side navigation shown on wide viewports, in place of the bottom bar.
 *
 * Deliberately NOT a third copy of the nav: it renders the same `TabTrigger`s `app-tabs` builds, so
 * routing, focus and the badges come from one place. Only the button's presentation differs, which
 * is the same split `TabButton` already makes between its phone and desktop forms.
 *
 * Two forms. The SIDEBAR is a floating panel inset from the window's edges, the way a desktop
 * sidebar is drawn: the window's own controls in its top row on a Mac, groups of rows under small
 * headings. It holds no search field: the desktop's is the shell's, in the bar (`ShellSearchField`). The RAIL is the icon column a regular width too narrow for that gets (`navModeFor`).
 *
 * Layout is a sibling of `TabSlot`, not an overlay over it. An overlay would sit on top of content
 * that had already centred itself against the full window; taking real space means the page centres
 * in what's left, which is what `navInsetFor` encodes for the rest of the app.
 */
import { Image } from 'expo-image';
import { Ellipsis, type LucideIcon } from 'lucide-react-native';

import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { GlassSurface } from '@/components/glass-surface';
import { CaretDownIcon, ChevronUpIcon } from '@/components/icons/ui-icons';
import { BridgeThumbRadius, BridgeThumbSize } from '@/components/selector';
import { SidebarUpdate } from '@/components/sidebar-update';
import { COMICAL_ICON } from '@/data/selected-bridge';

import { useHover } from '@/hooks/use-hover';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { toggleSection, useSectionOpen } from '@/hooks/use-sidebar-sections';
import { useTheme } from '@/hooks/use-theme';
import { desktopShell } from '@/lib/desktop-shell';
import { DISCLOSE_TIMING } from '@/lib/disclose';
import { focusSkip } from '@/lib/focus-nav';
import { windowDragRegion } from '@/lib/window-controls';
import { ContinuousCorner, Fonts, Spacing } from '@/constants/theme';

/** A rail destination's height. Named because the rail's top padding is derived from it. */
const RAIL_ITEM_HEIGHT = 44;

/** How far the panel floats in from the window's edges, and from the content beside it. */
const SIDEBAR_INSET = 8;
const PANEL_RADIUS = 18;
const TOP_ROW_HEIGHT = 48;
const TOP_BUTTON = 28;
const ROW_HEIGHT = 30;

/** The room the window's own close, minimise and zoom buttons take at the head of the panel's top
 *  row, where the desktop shell draws them inside the window (`trafficLightPosition` in the shell's
 *  `main.ts`, which is what puts them on this row's centre line). */
const TRAFFIC_LIGHTS_WIDTH = 60;
const MAC_SHELL = desktopShell()?.platform === 'darwin';

/** A row's thumbnail. Its corner matches the top bar's thumbnail by RATIO, not by copying the
 *  pixel value: at this size the bar's own radius would read as a lozenge rather than the same
 *  shape. */
export const SidebarThumbSize = 16;
export const SidebarThumbRadius = Math.round(SidebarThumbSize * (BridgeThumbRadius / BridgeThumbSize));

export type SidebarAction = {
  icon: React.ReactNode;
  badge?: React.ReactNode;
  label: string;
  active?: boolean;
  onPress: () => void;
  testID: string;
};

export function AppSidebar({
  top,
  rail,
  actions,
  children,
}: {
  top: number;
  rail: boolean;
  /** The buttons at the end of the panel's top row: what opens something (Settings, a search
   *  screen) rather than being a place among the groups below. */
  actions?: SidebarAction[];
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const barHeight = useTopBarHeight();
  // The arrows never reach the nav (lib/focus-nav): the digit keys are its keyboard, a press to move
  // to a destination and another to step through its scope (`TabKeys` in app-tabs).
  if (rail) {
    return (
      <View
        {...focusSkip}
        style={[styles.rail, { borderRightColor: theme.barHairline, backgroundColor: theme.background }]}>
        <ScrollView
          style={styles.scroller}
          // Centres the FIRST item against the bar's title rather than padding by a round number:
          // the bar is `barHeight` tall below the inset and centres its content.
          contentContainerStyle={[styles.railContent, { paddingTop: top + barHeight / 2 - RAIL_ITEM_HEIGHT / 2 }]}
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    );
  }
  return (
    <View
      {...focusSkip}
      // The page's colour around the panel: what is behind the slot is the window's, not the theme's.
      style={[styles.floating, { paddingTop: top + SIDEBAR_INSET, backgroundColor: theme.background }]}>
      <GlassSurface panel style={styles.panel}>
        <View {...windowDragRegion} style={styles.topRow}>
          {MAC_SHELL ? (
            <View style={styles.trafficLights} />
          ) : (
            <Image source={COMICAL_ICON} style={styles.mark} contentFit="cover" />
          )}
          <View style={styles.topRowActions}>
            <SidebarUpdate />
            {actions?.map((action) => <TopRowButton key={action.testID} {...action} />)}
          </View>
        </View>
        <ScrollView
          style={styles.scroller}
          contentContainerStyle={styles.panelContent}
          // A sidebar is nav, not a document: a scrollbar down its edge reads as a second divider.
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </GlassSurface>
    </View>
  );
}

function TopRowButton({ icon, badge, label, active, onPress, testID }: SidebarAction) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      {...handlers}
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.topButton,
        { backgroundColor: active ? theme.glassSelected : hovered ? theme.glassHover : 'transparent' },
        pressed && styles.pressed,
      ]}>
      <View>
        {icon}
        {badge}
      </View>
    </Pressable>
  );
}

/** Extends `PressableProps` so a `TabTrigger`'s injected props (onPress, testID, accessibility)
 *  pass straight through — the trigger owns navigation, this owns presentation. */
type RailItemProps = PressableProps & {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: React.ReactNode;
};

/** A destination in the icon rail. */
export function SidebarRailItem({
  Icon,
  label,
  active,
  badge,
  onPress,
  testID,
  accessibilityRole = 'tab',
  ...props
}: RailItemProps) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  const color = active ? theme.text : theme.textSecondary;
  return (
    <Pressable
      {...props}
      {...handlers}
      // Destructured out of `props` and set explicitly: the trigger does supply it, but
      // `comical/require-test-id` is a syntactic rule and can't see a prop arriving via spread.
      testID={testID}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.railItem,
        { backgroundColor: active ? theme.backgroundSelected : hovered ? theme.backgroundElement : 'transparent' },
        pressed && styles.pressed,
      ]}>
      <View>
        <Icon size={22} color={color} strokeWidth={active ? 2.25 : 2} />
        {badge}
      </View>
    </Pressable>
  );
}

type HeadingProps = PressableProps & {
  label: string;
  /** The section this heads, in `use-sidebar-sections`. */
  section: string;
};

/**
 * A group's heading. Its label is the group's destination where it has one — Browse, Library: a
 * press goes to that tab's front door — and the caret beside it opens and closes the group. A
 * heading that leads nowhere (Reading) is the caret's button whole.
 *
 * The two are SIBLINGS, never nested: nested Pressables both fire on react-native-web, whose
 * responder ignores the inner one's `stopPropagation`, so a nested caret navigated on every toggle.
 */
export function SidebarHeading({
  label,
  section,
  onPress,
  testID,
  accessibilityRole = 'tab',
  ...props
}: HeadingProps) {
  const theme = useTheme();
  const open = useSectionOpen(section);
  const toggle = () => toggleSection(section);
  const text = <Text style={[styles.headingLabel, { color: theme.textSecondary }]}>{label}</Text>;
  const caret = <Caret open={open} color={theme.textSecondary} />;
  if (!onPress) {
    return (
      <Pressable
        testID={`sidebar.group.${section}.disclose`}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${label}`}
        accessibilityState={{ expanded: open }}
        style={[styles.heading, styles.headingButton]}>
        {text}
        {caret}
      </Pressable>
    );
  }
  return (
    <View style={styles.heading}>
      <Pressable
        {...props}
        testID={testID}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole={accessibilityRole}
        style={styles.headingButton}>
        {text}
      </Pressable>
      <Pressable
        testID={`${testID ?? 'sidebar'}.disclose`}
        onPress={toggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${label}`}
        accessibilityState={{ expanded: open }}
        style={styles.headingCaret}>
        {caret}
      </Pressable>
    </View>
  );
}

/** ONE caret that turns, not two glyphs swapped: a swap is a cut, and a group opening is
 *  continuous. Down while open, aside once closed. */
function Caret({ open, color }: { open: boolean; color: string }) {
  const turn = useSharedValue(open ? 0 : 1);
  useEffect(() => {
    turn.value = withTiming(open ? 0 : 1, DISCLOSE_TIMING);
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * -90}deg` }] }));
  return (
    <Animated.View style={style}>
      <CaretDownIcon color={color} size={8} />
    </Animated.View>
  );
}

type RowProps = PressableProps & {
  label: string;
  active?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Quieter than a destination: the More row, which is the group's own control. */
  muted?: boolean;
};

/** A row of the sidebar: a destination, or one of a group's scopes. Takes a `TabTrigger`'s injected
 *  props the way `SidebarRailItem` does. */
export function SidebarRow({
  label,
  active,
  leading,
  trailing,
  muted,
  onPress,
  testID,
  accessibilityRole = 'tab',
  ...props
}: RowProps) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      {...props}
      {...handlers}
      testID={testID}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.row,
        // Hover and selected are DIFFERENT washes: sharing one made hovering any row look chosen.
        { backgroundColor: active ? theme.glassSelected : hovered ? theme.glassHover : 'transparent' },
        pressed && styles.pressed,
      ]}>
      {leading ?? <View style={styles.rowSlot} />}
      {/* `numberOfLines` so a long label truncates rather than wrapping a fixed-height row. */}
      <Text
        numberOfLines={1}
        style={[
          styles.rowLabel,
          { color: muted ? theme.textSecondary : theme.text, fontWeight: active ? '600' : '500' },
        ]}>
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

/** A row's trailing number: how many are unread, or how many More stands for. */
export function SidebarCount({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return <Text style={[styles.count, { color: theme.textSecondary }]}>{count > 99 ? '99+' : count}</Text>;
}

/** What closes a long group's list down to its first rows, and opens it again (`sidebar-fold`). */
export function SidebarMoreRow({
  section,
  open,
  hidden,
  testID,
}: {
  section: string;
  open: boolean;
  hidden: number;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <SidebarRow
      testID={testID}
      label={open ? 'Show less' : 'More'}
      muted
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      leading={
        open ? (
          <ChevronUpIcon color={theme.textSecondary} size={SidebarThumbSize} />
        ) : (
          <Ellipsis color={theme.textSecondary} size={SidebarThumbSize} />
        )
      }
      trailing={open ? undefined : <SidebarCount count={hidden} />}
      onPress={() => toggleSection(section, false)}
    />
  );
}

/**
 * A group's rows, which open and close under its heading.
 *
 * Height has to be MEASURED, not guessed: the rows are query-backed, so how many there are isn't
 * known until they arrive, and animating to a wrong height either clips the last row or leaves a gap
 * under it. The inner view lays out at its natural size and reports it; the outer clips to whatever
 * fraction of that the animation is at.
 *
 * The children stay MOUNTED while closed, which is the trade this makes on purpose. Unmounting them
 * would save two query subscriptions, but there would then be nothing to measure at the moment the
 * group is asked to open, so the first open of every group would snap instead of animating.
 */
export function SidebarGroup({ name, testID, children }: { name: string; testID: string; children: React.ReactNode }) {
  const open = useSectionOpen(name);
  // A shared value rather than state: read through the worklet's closure, a height captured at 0
  // can stay 0 for the animation's whole life (see the chapter list's Disclosure).
  const measured = useSharedValue(0);
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, DISCLOSE_TIMING);
  }, [open, progress]);
  const style = useAnimatedStyle(() => ({
    height: progress.value * measured.value,
    // Fades over the FIRST half of the travel, so a group on its way out is gone before it has
    // finished shrinking — the rows below it then slide up past empty space rather than through
    // text that is still legible.
    opacity: Math.min(1, progress.value * 2),
  }));
  return (
    <Animated.View testID={testID} style={[styles.group, style]}>
      <View style={styles.groupRows} onLayout={(e) => measured.set(e.nativeEvent.layout.height)}>
        {children}
      </View>
    </Animated.View>
  );
}

const pointer = Platform.OS === 'web' ? { cursor: 'pointer' as const } : null;

const styles = StyleSheet.create({
  // The nav's frame. Its WIDTH comes from the animated wrapper in `app-tabs`, so the edge can track
  // a drag on the UI thread; everything here just fills it.
  rail: {
    flex: 1,
    width: '100%',
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  floating: {
    flex: 1,
    width: '100%',
    paddingLeft: SIDEBAR_INSET,
    paddingRight: SIDEBAR_INSET,
    paddingBottom: SIDEBAR_INSET,
  },
  panel: {
    flex: 1,
    borderRadius: PANEL_RADIUS,
    overflow: 'hidden',
  },
  scroller: {
    flex: 1,
  },
  // Padding and gap belong to the CONTENT, not the scroller: on the scroller they'd clip the rows
  // rather than travel with them, and the last row would sit flush against the bottom edge.
  railContent: {
    paddingHorizontal: Spacing.one,
    paddingBottom: Spacing.three,
    gap: Spacing.one,
  },
  panelContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TOP_ROW_HEIGHT,
    paddingLeft: 16,
    paddingRight: 10,
  },
  trafficLights: {
    width: TRAFFIC_LIGHTS_WIDTH,
  },
  mark: {
    width: 20,
    height: 20,
    borderRadius: 5,
  },
  topRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginLeft: 'auto',
  },
  topButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: TOP_BUTTON,
    height: TOP_BUTTON,
    borderRadius: TOP_BUTTON / 2,
    ...pointer,
  },
  railItem: {
    alignItems: 'center',
    justifyContent: 'center',
    height: RAIL_ITEM_HEIGHT,
    ...ContinuousCorner,
    borderRadius: Spacing.two,
    ...pointer,
  },
  pressed: { opacity: 0.6 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: 14,
    paddingBottom: 5,
    paddingHorizontal: 10,
  },
  headingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    ...pointer,
  },
  headingCaret: {
    ...pointer,
  },
  headingLabel: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: ROW_HEIGHT,
    paddingHorizontal: 10,
    borderRadius: 8,
    ...pointer,
  },
  // Keeps a row without art in line with its neighbours' labels.
  rowSlot: { width: SidebarThumbSize, height: SidebarThumbSize },
  rowLabel: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    flexShrink: 1,
    flexGrow: 1,
  },
  count: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '600',
  },
  // Clips the measured children to the animated fraction of their height.
  group: {
    overflow: 'hidden',
  },
  // Out of flow for the measurement's sake: see the chapter list's `disclosureContent`.
  groupRows: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Between the rows rather than on the panel's content: that gap only separates the headings
    // and the groups, and flush highlights read as one block.
    gap: 1,
  },
});
