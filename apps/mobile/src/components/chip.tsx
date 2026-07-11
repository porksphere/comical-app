import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useIsLargeScreen } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import type { TagGroup } from '@/data/mock';

// Genre / tag chips and a labeled tag-group row. Mirrors `.chip` / `.tag-group`
// in the reference.

/** Cap on chips shown before a row collapses behind a "Show all" chip — a bridge
 *  with a long genre or tag list would otherwise flood the whole
 *  series page. Matches `ChaptersSection`'s own collapse pattern: expanding is a
 *  one-way, per-row reveal (no re-collapse) rather than a toggle. Viewport-relative:
 *  a desktop column is wide enough to comfortably wrap far more chips before the
 *  row gets unwieldy than a phone-width column can. */
const MAX_VISIBLE_CHIPS_COMPACT = 20;
const MAX_VISIBLE_CHIPS_WIDE = 48;

function useMaxVisibleChips(): number {
  const wide = useIsLargeScreen();
  return wide ? MAX_VISIBLE_CHIPS_WIDE : MAX_VISIBLE_CHIPS_COMPACT;
}

export function Chip({
  label,
  accent,
  highlighted,
}: {
  label: string;
  accent?: boolean;
  /** Brightens the fill (hover) — set by `PressableChip`, never by a static chip. */
  highlighted?: boolean;
}) {
  const theme = useTheme();
  // Matches the reference: every chip shares the neutral `chipBg` fill; tags
  // (`accent`) carry a blue border + blue text, while plain chips (genres) get a
  // subtle border and muted text — rather than a blue-tinted fill.
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: highlighted ? theme.backgroundSelected : theme.chipBg,
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

/** Wraps a tappable chip (an actionable tag, or the "+N more" expander) with
 *  press + hover feedback — a plain `Chip` has none, since most chips are
 *  static. One instance per chip so each gets its own `useHovered` (chips are
 *  rendered from a `.map`, where a hook can't be called directly). Renders the
 *  `Chip` itself (rather than taking it as `children`) so hover can brighten
 *  its fill directly — the same "lighten, don't dim" treatment as the chapter
 *  tab strip — instead of dimming the whole chip via opacity. */
function PressableChip({
  label,
  accent,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  accent?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => pressed && styles.chipPressed}>
      <Chip label={label} accent={accent} highlighted={hovered} />
    </Pressable>
  );
}

export function ChipRow({ labels, accent, horizontal }: { labels: string[]; accent?: boolean; horizontal?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const maxVisible = useMaxVisibleChips();
  if (!labels.length) return null;
  // A single non-wrapping horizontally-scrolling row (used in the card preview panel) — all chips,
  // no collapse (the scroll handles overflow).
  if (horizontal) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hChips}>
        {labels.map((l) => (
          <Chip key={l} label={l} accent={accent} />
        ))}
      </ScrollView>
    );
  }
  const collapsible = !expanded && labels.length > maxVisible;
  const shown = collapsible ? labels.slice(0, maxVisible) : labels;
  return (
    <View style={styles.row}>
      {shown.map((l) => (
        <Chip key={l} label={l} accent={accent} />
      ))}
      {collapsible && (
        <PressableChip
          onPress={() => setExpanded(true)}
          accessibilityLabel="Show all"
          label={`+${labels.length - maxVisible} more`}
        />
      )}
    </View>
  );
}

export function TagGroupRow({
  group,
  onTagPress,
  horizontal,
}: {
  group: TagGroup;
  /** Called with a tapped tag's index. Only tags the bridge made actionable — a
   *  `tagIds`/`tagQueries` entry at that index — render as pressable; the rest
   *  (e.g. a Characters/Parodies group with no ids/queries) stay static. */
  onTagPress?: (index: number) => void;
  /** Render as a labeled, non-wrapping horizontally-scrolling row (used in the card preview panel)
   *  instead of the wrapping, collapsible layout. */
  horizontal?: boolean;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const maxVisible = useMaxVisibleChips();
  if (!group.tags.length) return null;
  const chip = (t: string, i: number) => {
    const actionable = !!onTagPress && !!(group.tagQueries?.[i] || group.tagIds?.[i]);
    return actionable ? (
      <PressableChip key={t} onPress={() => onTagPress!(i)} accessibilityLabel={`Search ${t}`} label={t} accent />
    ) : (
      <Chip key={t} label={t} accent />
    );
  };
  if (horizontal) {
    return (
      <View style={styles.tagGroupHeaderRow}>
        <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>{group.label.toUpperCase()}</ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hChips}>
          {group.tags.map(chip)}
        </ScrollView>
      </View>
    );
  }
  const collapsible = !expanded && group.tags.length > maxVisible;
  const shown = collapsible ? group.tags.slice(0, maxVisible) : group.tags;
  return (
    <View style={styles.tagGroup}>
      <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>
        {group.label.toUpperCase()}
      </ThemedText>
      {shown.map((t, i) => {
        const actionable = !!onTagPress && !!(group.tagQueries?.[i] || group.tagIds?.[i]);
        return actionable ? (
          <PressableChip key={t} onPress={() => onTagPress!(i)} accessibilityLabel={`Search ${t}`} label={t} accent />
        ) : (
          <Chip key={t} label={t} accent />
        );
      })}
      {collapsible && (
        <PressableChip
          onPress={() => setExpanded(true)}
          accessibilityLabel="Show all"
          label={`+${group.tags.length - maxVisible} more`}
        />
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
  // Horizontal variant: fixed label + a single scrolling chip row that takes the rest of the width.
  tagGroupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  hScroll: {
    flex: 1,
  },
  hChips: {
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
  chipPressed: {
    opacity: 0.65,
  },
});
