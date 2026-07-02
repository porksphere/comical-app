import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A titled card grouping related `SettingsRow`s — the Settings screen's section shape. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.section, { borderColor: theme.hairline }]}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {children}
    </ThemedView>
  );
}

/**
 * One settings row: label (+ optional description) on the left, arbitrary
 * content (`right`, e.g. a `Switch` or a value string) on the right. Pass
 * `onPress` to make the whole row tappable — it grows a trailing `›` unless
 * `right` is already provided (a Switch shouldn't also show a chevron).
 */
export function SettingsRow({
  label,
  description,
  right,
  onPress,
}: {
  label: string;
  description?: string;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <ThemedText type="small">{label}</ThemedText>
        {description && (
          <ThemedText type="small" themeColor="textSecondary">
            {description}
          </ThemedText>
        )}
      </View>
      {right ?? (onPress && <ThemedText themeColor="textSecondary">{'›'}</ThemedText>)}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.five,
    padding: Spacing.four,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
