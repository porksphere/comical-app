import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';

/** A titled card grouping related `SettingsRow`s — the Settings screen's section shape.
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
  return (
    <ThemedView type="backgroundElement" style={[styles.section, { borderColor: theme.hairline }]}>
      <View style={styles.sectionHeader}>
        {icon}
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          {title}
        </ThemedText>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </ThemedView>
  );
}

/**
 * One settings row: label (+ optional description) on the left, arbitrary
 * content (`right`, e.g. a `Switch` or a value string) on the right. Pass
 * `onPress` to make the whole row tappable — it grows a trailing chevron unless
 * `right` is already provided (a Switch shouldn't also show a chevron). A
 * pressable row gets a full-bleed rounded highlight on press (touch) and hover
 * (mouse/trackpad on web), so it reads as a control rather than static text —
 * the previous version only dimmed text opacity, which gave pointer users no
 * feedback until the click actually landed.
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
    <View style={[styles.row, onPress && styles.rowPressable, highlighted && { backgroundColor: theme.backgroundSelected }]}>
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
    <Pressable onPress={onPress} onHoverIn={onHoverIn} onHoverOut={onHoverOut} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => content(pressed || hovered)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.five,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    width: '100%',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {
    gap: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 44,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
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
