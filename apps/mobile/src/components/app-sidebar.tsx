/**
 * The side navigation shown on wide viewports, in place of the top-right icon row.
 *
 * Deliberately NOT a third copy of the nav: it renders the same `TabTrigger`s `app-tabs` builds, so
 * routing, focus and the badges come from one place. Only the button's presentation differs, which
 * is the same split `TabButton` already makes between its phone and desktop forms.
 *
 * Layout is a sibling of `TabSlot`, not an overlay over it. An overlay would sit on top of content
 * that had already centred itself against the full window; taking real space means the page centres
 * in what's left, which is what `navInsetFor` encodes for the rest of the app.
 */
import { type LucideIcon } from 'lucide-react-native';

import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type PressableProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ChevronRightIcon } from '@/components/icons/ui-icons';

import { useHover } from '@/hooks/use-hover';
import { useSectionOpen } from '@/hooks/use-sidebar-sections';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Spacing } from '@/constants/theme';

/** Short, and eased out: a disclosure is an acknowledgement of a tap, not a transition between
 *  places. Long enough to read as movement, short enough that a second tap never queues behind it. */
const DISCLOSE_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) };

/** A row in the sidebar. `active` drives the pill; the icon and label come from the tab table. */
/** Extends `PressableProps` so a `TabTrigger`'s injected props (onPress, testID, accessibility)
 *  pass straight through — the trigger owns navigation, this owns presentation. */
type SidebarItemProps = PressableProps & {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: React.ReactNode;
  /** This row owns a scope group, drawn directly beneath it. The chevron is the only thing that says
   *  so — there is no group heading, because the row IS the heading. */
  scope?: boolean;
  /** Whether that group is expanded, and how to flip it. Separate from `active`: the row navigates,
   *  the chevron discloses, and neither implies the other. */
  expanded?: boolean;
  onToggleScope?: () => void;
};

export function SidebarItem({
  Icon,
  label,
  active,
  badge,
  scope,
  expanded,
  onToggleScope,
  onPress,
  testID,
  ...props
}: SidebarItemProps) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();

  // Active is a filled pill; hover is the same neutral surface at rest opacity, so moving down the
  // list previews the shape the selected row already has rather than introducing a new one.
  // A row with a scope group never takes the filled pill: one of its children always holds the
  // selection (there is always a current bridge, always a current collection), so filling both
  // stacks two selected-looking rows and leaves the actual choice ambiguous. Weight, colour and the
  // chevron still mark it as the section you're in; only the fill moves down.
  const selectedFill = active && !scope;
  const background = selectedFill || hovered ? theme.backgroundSelected : 'transparent';
  const color = active ? theme.text : theme.textSecondary;

  return (
    // The chevron is a SIBLING of the navigating row, not a child of it. Nested Pressables both fire
    // on react-native-web — `stopPropagation` on the inner one doesn't stop the outer, which uses its
    // own responder rather than the DOM click — so a nested chevron navigated to the destination
    // every time you tried to peek at its list, which is the exact coupling this split removes.
    <View style={styles.row}>
      <Pressable
        {...props}
        {...handlers}
        // Destructured out of `props` and set explicitly: the trigger does supply it, but
        // `comical/require-test-id` is a syntactic rule and can't see a prop arriving via spread.
        testID={testID}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          styles.item,
          { backgroundColor: background, opacity: !selectedFill && hovered ? 0.999 : 1 },
          pressed && styles.pressed,
        ]}>
        <View style={styles.iconWrap}>
          <Icon size={22} color={color} strokeWidth={active ? 2.25 : 2} />
          {badge}
        </View>
        {/* `numberOfLines` so a long label truncates rather than wrapping the row to two lines and
            breaking the rhythm of a fixed-height list. */}
        <Text numberOfLines={1} style={[styles.label, { color, fontWeight: active ? '600' : '500' }]}>
          {label}
        </Text>
      </Pressable>
      {scope ? (
        <Pressable
          testID={`${testID ?? 'sidebar'}.disclose`}
          onPress={onToggleScope}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
          accessibilityState={{ expanded }}
          style={styles.disclose}>
          <Chevron open={expanded} color={color} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The rail itself: a fixed-width column with a hairline against the content.
 *
 *  `flex: 1` matters — without it the column is only as tall as its items and the page background
 *  shows through beneath them, which reads as a floating card rather than a rail. */
export function AppSidebar({
  top,
  width,
  children,
}: {
  top: number;
  width: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      style={[styles.sidebar, { width, borderRightColor: theme.barHairline, backgroundColor: theme.background }]}
      contentContainerStyle={[styles.sidebarContent, { paddingTop: top + Spacing.three }]}
      // A rail is nav, not a document: a scrollbar parked down its edge reads as a second column
      // divider. It scrolls when an expanded group outgrows the viewport and is invisible otherwise.
      showsVerticalScrollIndicator={false}>
      {/* No wordmark. One was here to "replace the top bar's title", but the row that goes away at
          this width is the top-RIGHT icon nav — the bar's own title row stays — so it replaced
          nothing, and once the Bridges group landed below it the rail printed "Comical" twice: once
          as dead chrome and once as the live aggregate row. The app is named by its window title and
          its icon; a nav rail naming its own app is not how anything else does it. */}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    flex: 1,
    // `width` is set inline — it's a preference now, not a constant (see `use-sidebar-width`).
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  // Padding and gap belong to the CONTENT, not the scroller: on the scroller they'd clip the rows
  // rather than travel with them, and the last row would sit flush against the bottom edge.
  sidebarContent: {
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.one,
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    // The pointer cursor react-native-web gives a Pressable is right here — these are nav links.
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
  },
  pressed: { opacity: 0.6 },
  iconWrap: { position: 'relative' },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    flexShrink: 1,
  },
  subItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 34,
    // Indented to the top-level rows' LABEL, not their icon, so the hierarchy is legible at a glance.
    paddingLeft: Spacing.three + 22 + Spacing.three - 18,
    paddingRight: Spacing.three,
    borderRadius: Spacing.two,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
  },
  // The row and the chevron sit side by side; the row takes the slack so the pill still spans the
  // label, and the chevron keeps a target of its own at the trailing edge.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  disclose: {
    padding: Spacing.two,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
  },
  // Clips the measured children to the animated fraction of their height.
  group: {
    overflow: 'hidden',
  },
  subDot: { width: 18, height: 18 },
  subLabel: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    flexShrink: 1,
  },
});


/** ONE chevron that rotates, not two glyphs swapped: a swap is a cut, and the thing being described
 *  — a group opening — is continuous. Right-pointing at rest, down at 90°, so the rotation reads as
 *  the disclosure turning rather than an arrow spinning. */
function Chevron({ open, color }: { open?: boolean; color: string }) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, DISCLOSE_TIMING);
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 90}deg` }] }));
  return (
    <Animated.View style={style}>
      <ChevronRightIcon color={color} size={14} />
    </Animated.View>
  );
}

/**
 * A scope group that opens and closes.
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
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, DISCLOSE_TIMING);
  }, [open, progress]);
  const style = useAnimatedStyle(() => ({
    height: progress.value * height,
    // Fades over the FIRST half of the travel, so a group on its way out is gone before it has
    // finished shrinking — the rows below it then slide up past empty space rather than through
    // text that is still legible.
    opacity: Math.min(1, progress.value * 2),
  }));
  return (
    <Animated.View testID={testID} style={[styles.group, style]}>
      <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  );
}

/** A child row inside a section — indented, lighter, and without the icon slot the top-level
 *  destinations use, so the two levels never read as peers. */
export function SidebarSubItem({
  label,
  active,
  thumbnail,
  testID,
  onPress,
}: {
  label: string;
  active?: boolean;
  thumbnail?: React.ReactNode;
  testID: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  const color = active ? theme.text : theme.textSecondary;

  return (
    <Pressable
      {...handlers}
      testID={testID}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.subItem,
        (active || hovered) && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      {thumbnail ?? <View style={styles.subDot} />}
      <Text numberOfLines={1} style={[styles.subLabel, { color, fontWeight: active ? '600' : '400' }]}>
        {label}
      </Text>
    </Pressable>
  );
}
