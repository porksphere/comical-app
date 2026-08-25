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
      {/* The wordmark takes the place the top bar's own title held, so the app still identifies
          itself once the top row is gone. */}
      <Text style={[styles.wordmark, { color: theme.text }]}>Comical</Text>
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
  wordmark: {
    fontFamily: Fonts.sans,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
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
});
