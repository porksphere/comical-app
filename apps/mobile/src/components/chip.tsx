import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TagGroup } from '@/data/mock';

// Genre / tag chips and a labeled tag-group row. Mirrors `.chip` / `.tag-group`
// in the reference.

/** Cap on chips shown before a row collapses behind a "Show all" chip — a bridge
 *  with a long genre or tag list (example-bridge-style) would otherwise flood the whole
 *  series page. Matches `ChaptersSection`'s own collapse pattern: expanding is a
 *  one-way, per-row reveal (no re-collapse) rather than a toggle. */
const MAX_VISIBLE_CHIPS = 10;

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
  const [expanded, setExpanded] = useState(false);
  if (!labels.length) return null;
  const collapsible = !expanded && labels.length > MAX_VISIBLE_CHIPS;
  const shown = collapsible ? labels.slice(0, MAX_VISIBLE_CHIPS) : labels;
  return (
    <View style={styles.row}>
      {shown.map((l) => (
        <Chip key={l} label={l} accent={accent} />
      ))}
      {collapsible && (
        <Pressable onPress={() => setExpanded(true)} accessibilityRole="button" accessibilityLabel="Show all">
          <Chip label={`+${labels.length - MAX_VISIBLE_CHIPS} more`} />
        </Pressable>
      )}
    </View>
  );
}

export function TagGroupRow({
  group,
  onTagPress,
}: {
  group: TagGroup;
  /** Called with a tapped tag's index. Only tags the bridge made actionable — a
   *  `tagIds`/`tagQueries` entry at that index — render as pressable; the rest
   *  (e.g. example-bridge's Characters/Parodies groups) stay static. */
  onTagPress?: (index: number) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (!group.tags.length) return null;
  const collapsible = !expanded && group.tags.length > MAX_VISIBLE_CHIPS;
  const shown = collapsible ? group.tags.slice(0, MAX_VISIBLE_CHIPS) : group.tags;
  return (
    <View style={styles.tagGroup}>
      <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>
        {group.label.toUpperCase()}
      </ThemedText>
      {shown.map((t, i) => {
        const actionable = !!onTagPress && !!(group.tagQueries?.[i] || group.tagIds?.[i]);
        return actionable ? (
          <Pressable
            key={t}
            onPress={() => onTagPress!(i)}
            accessibilityRole="button"
            accessibilityLabel={`Search ${t}`}>
            <Chip label={t} accent />
          </Pressable>
        ) : (
          <Chip key={t} label={t} accent />
        );
      })}
      {collapsible && (
        <Pressable onPress={() => setExpanded(true)} accessibilityRole="button" accessibilityLabel="Show all">
          <Chip label={`+${group.tags.length - MAX_VISIBLE_CHIPS} more`} />
        </Pressable>
      )}
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
