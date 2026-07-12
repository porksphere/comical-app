import { Children, Fragment, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

/** A titled group of `SettingsRow`s — the Settings screen's section shape. The
 *  title sits above a bordered card holding the rows, with a hairline divider
 *  between each row (inset to align under the row's label) instead of a plain
 *  gap — this is how both iOS Settings (inset-grouped table) and Android's
 *  Material 3 Settings (rounded surface list) lay out a group of settings
 *  today, so it reads as one native-feeling list on both platforms rather
 *  than a stack of separate cards.
 *  `icon` is an optional leading glyph next to the title, for scanability on the top-level
 *  Settings screen where several sections sit in a row (especially on wide desktop layouts,
 *  where a plain text-only heading reads sparse). */
export function SettingsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeader}>
        {icon}
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          {title}
        </ThemedText>
      </View>
      <ThemedView type="backgroundElement" style={[styles.section, { borderColor: theme.hairline }]}>
        {items.map((item, i) => (
          <Fragment key={i}>
            {item}
            {i < items.length - 1 && <View style={[styles.divider, { backgroundColor: theme.hairline }]} />}
          </Fragment>
        ))}
      </ThemedView>
    </View>
  );
}

/**
 * One settings row: label (+ optional description) on the left, arbitrary
 * content (`right`, e.g. a `Switch` or a value string) on the right. Pass
 * `onPress` to make the whole row tappable — it grows a trailing chevron unless
 * `right` is already provided (a Switch shouldn't also show a chevron). A
 * pressable row gets a full-bleed rounded highlight on press (touch) and hover
 * (mouse/trackpad on web); Android additionally gets a ripple, which stands in
 * for the highlight there so the two don't visually stack.
 */
export function SettingsRow({
  label,
  description,
  descriptionColor,
  descriptionSelectable,
  right,
  onPress,
}: {
  label: string;
  description?: string;
  /** Overrides the description's color (e.g. an amber/blue status hint) — defaults to `textSecondary`. */
  descriptionColor?: string;
  /** Lets the description text be selected/copied (e.g. a server URL) — off by default. */
  descriptionSelectable?: boolean;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const content = (highlighted?: boolean) => (
    <View
      style={[
        styles.row,
        onPress && styles.rowPressable,
        highlighted && Platform.OS !== 'android' && { backgroundColor: theme.backgroundSelected },
      ]}>
      <View style={styles.rowText}>
        <ThemedText type="small">{label}</ThemedText>
        {description && (
          <ThemedText type="small" selectable={descriptionSelectable} style={{ color: descriptionColor ?? theme.textSecondary }}>
            {description}
          </ThemedText>
        )}
      </View>
      {right ?? (onPress && <ChevronRightIcon color={theme.textSecondary} size={18} />)}
    </View>
  );
  if (!onPress) return content();
  return (
    <Pressable
      onPress={() => {
        hapticImpactLight();
        onPress();
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      accessibilityRole="button"
      accessibilityLabel={label}>
      {({ pressed }) => content(pressed || hovered)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No marginTop: that would also push the FIRST section down, stacking on top of the screen's
  // `BarContentGap` and making every settings-style screen start lower than the other tabs. The space
  // BETWEEN sections is the container's `gap` (Spacing.five), which never applies before the first.
  sectionWrap: {
    width: '100%',
  },
  section: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.two,
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 48,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  rowPressable: {
    cursor: 'pointer',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
