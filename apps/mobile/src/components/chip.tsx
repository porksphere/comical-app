import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TagGroup } from '@/data/mock';

// Genre / tag chips and a labeled tag-group row. Mirrors `.chip` / `.tag-group`
// in the reference.

export function Chip({ label, accent }: { label: string; accent?: boolean }) {
  const theme = useTheme();
  // Matches the reference: every chip shares the neutral `chipBg` fill; tags
  // (`accent`) carry a blue border + blue text, while plain chips (genres) get a
  // subtle border and muted text — rather than a blue-tinted fill.
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: theme.chipBg,
          borderColor: accent ? theme.chipBorder : theme.hairline,
        },
      ]}>
      <ThemedText
        style={[styles.chipText, { color: accent ? theme.chipText : theme.textSecondary }]}
        numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

export function ChipRow({ labels, accent }: { labels: string[]; accent?: boolean }) {
  if (!labels.length) return null;
  return (
    <View style={styles.row}>
      {labels.map((l) => (
        <Chip key={l} label={l} accent={accent} />
      ))}
    </View>
  );
}

export function TagGroupRow({ group }: { group: TagGroup }) {
  const theme = useTheme();
  if (!group.tags.length) return null;
  return (
    <View style={styles.tagGroup}>
      <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>
        {group.label.toUpperCase()}
      </ThemedText>
      {group.tags.map((t) => (
        <Chip key={t} label={t} accent />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
  },
  tagGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
  },
  groupLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: '700',
    marginRight: Spacing.half,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
