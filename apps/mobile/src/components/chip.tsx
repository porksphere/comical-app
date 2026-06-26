import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TagGroup } from '@/data/mock';

// Genre / tag chips and a labeled tag-group row. Mirrors `.chip` / `.tag-group`
// in the reference.

export function Chip({ label, accent }: { label: string; accent?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: accent ? theme.chipBg : theme.backgroundElement,
          borderColor: accent ? theme.chipBorder : theme.hairline,
        },
      ]}>
      <ThemedText style={[styles.chipText, accent && { color: theme.chipText }]} numberOfLines={1}>
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
    marginBottom: Spacing.one,
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
