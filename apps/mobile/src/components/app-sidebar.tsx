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
import { Platform, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';

import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons/ui-icons';

import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, SidebarWidth, Spacing } from '@/constants/theme';

/** A row in the sidebar. `active` drives the pill; the icon and label come from the tab table. */
/** Extends `PressableProps` so a `TabTrigger`'s injected props (onPress, testID, accessibility)
 *  pass straight through — the trigger owns navigation, this owns presentation. */
type SidebarItemProps = PressableProps & {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: React.ReactNode;
};

export function SidebarItem({
  Icon,
  label,
  active,
  badge,
  onPress,
  testID,
  ...props
}: SidebarItemProps) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();

  // Active is a filled pill; hover is the same neutral surface at rest opacity, so moving down the
  // list previews the shape the selected row already has rather than introducing a new one.
  const background = active ? theme.backgroundSelected : hovered ? theme.backgroundSelected : 'transparent';
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
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.item,
        { backgroundColor: background, opacity: !active && hovered ? 0.999 : 1 },
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
  );
}

/** The rail itself: a fixed-width column with a hairline against the content.
 *
 *  `flex: 1` matters — without it the column is only as tall as its items and the page background
 *  shows through beneath them, which reads as a floating card rather than a rail. */
export function AppSidebar({ top, children }: { top: number; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.sidebar,
        { paddingTop: top + Spacing.three, borderRightColor: theme.barHairline, backgroundColor: theme.background },
      ]}>
      {/* No wordmark. One was here to "replace the top bar's title", but the row that goes away at
          this width is the top-RIGHT icon nav — the bar's own title row stays — so it replaced
          nothing, and once the Bridges group landed below it the rail printed "Comical" twice: once
          as dead chrome and once as the live aggregate row. The app is named by its window title and
          its icon; a nav rail naming its own app is not how anything else does it. */}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    flex: 1,
    width: SidebarWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    gap: Spacing.one,
  },
  item: {
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
  section: { marginTop: Spacing.three },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    height: 28,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
  },
  sectionLabel: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionBody: { gap: 1, marginTop: Spacing.half },
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
  subDot: { width: 18, height: 18 },
  subLabel: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    flexShrink: 1,
  },
});

/**
 * A collapsible group — a heading that toggles its children.
 *
 * Collapsing is what makes an UNBOUNDED list safe in a fixed-height rail: a source can advertise
 * as many pages as it likes, and the five top-level destinations must never be pushed below the
 * fold by one. The open/closed choice is a device-local preference (`persisted$`), so a collapsed
 * group stays collapsed across launches rather than re-expanding to bury the nav again.
 */
export function SidebarSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;

  return (
    <View style={styles.section}>
      <Pressable
        {...handlers}
        testID={`sidebar.section.${label.toLowerCase()}`}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={[styles.sectionHeader, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <Chevron color={theme.textSecondary} size={14} />
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{label}</Text>
      </Pressable>
      {/* Unmounted, not hidden, when closed: the children are query-backed rows, and keeping a
          collapsed group mounted would keep re-rendering a list nobody can see. */}
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
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
