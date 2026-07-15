import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useIsLargeScreen } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { tagPaletteFor, type TagColor } from '@/lib/tag-colors';
import { testId } from '@/lib/test-id';
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
  color,
  highlighted,
}: {
  label: string;
  accent?: boolean;
  /** The tag group's own colour (see lib/tag-colors) — overrides `accent`'s default chip blue, so a
   *  chip says which GROUP it belongs to without a row heading to sit under. */
  color?: TagColor;
  /** Brightens the fill (hover) — set by `PressableChip`, never by a static chip. */
  highlighted?: boolean;
}) {
  const theme = useTheme();
  // Matches the reference: every chip shares the neutral `chipBg` fill; tags
  // (`accent`) carry a coloured border + coloured text, while plain chips (genres) get a
  // subtle border and muted text — rather than a tinted fill.
  const border = color ? color.border : accent ? theme.chipBorder : theme.hairline;
  const text = color ? color.text : accent ? theme.chipText : theme.textSecondary;
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: highlighted ? theme.backgroundSelected : theme.chipBg,
          borderColor: border,
        },
      ]}>
      <ThemedText style={[styles.chipText, { color: text }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * React key for a chip — the INDEX, not the label.
 *
 * A source can carry two DISTINCT tags that share a display label: identical text, different entries
 * in the group's `tagIds` (verified against live data — one group had the same label at two indices,
 * each with its own id). Keyed by label, those are two siblings on one key: a duplicate-key error.
 * That's the bug this fixes.
 *
 * So do NOT "fix" this by de-duplicating tags by label — they are not duplicates. Collapsing them
 * would silently drop a real, separately-filterable tag along with its id. The index is the chip's
 * true identity: `tagIds`/`tagQueries` are index-parallel to `tags`, so a chip means its POSITION,
 * not its text. Safe as a key because these rows never reorder or splice — they're rebuilt whole from
 * one series' payload. The label is folded in only to keep the key legible in devtools.
 */
const chipKey = (label: string, index: number) => `${index}:${label}`;

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
  color,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  accent?: boolean;
  color?: TagColor;
  onPress: () => void;
  accessibilityLabel: string;
  /** Automation selector (see src/lib/test-id.ts). */
  testID: string;
}) {
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => pressed && styles.chipPressed}>
      <Chip label={label} accent={accent} color={color} highlighted={hovered} />
    </Pressable>
  );
}

/** One group's tag chips, in that group's colour — the piece `TagGroupRow` (labelled rows, series
 *  page) and `TagStrip` (one unlabelled row, card popup) share, so a tag looks the same in both. */
function groupChips(
  group: TagGroup,
  color: TagColor,
  keyPrefix: string,
  onTagPress?: (index: number) => void,
): React.ReactElement[] {
  return group.tags.map((t, i) => {
    // Only tags the bridge made actionable — a `tagIds`/`tagQueries` entry at that index — are
    // pressable; the rest (e.g. a Characters/Parodies group with no ids/queries) stay static.
    const actionable = !!onTagPress && !!(group.tagQueries?.[i] || group.tagIds?.[i]);
    const key = `${keyPrefix}${chipKey(t, i)}`;
    return actionable ? (
      <PressableChip
        key={key}
        // Prefer the bridge's stable tag id/query over the display label (two tags can share a label).
        testID={testId('series.tag', group.tagIds?.[i] ?? group.tagQueries?.[i] ?? t)}
        onPress={() => onTagPress!(i)}
        accessibilityLabel={`Search ${t}`}
        label={t}
        accent
        color={color}
      />
    ) : (
      <Chip key={key} label={t} accent color={color} />
    );
  });
}

/**
 * Every tag group flattened into ONE horizontally-scrolling row, each chip carrying its group's
 * colour instead of sitting under a group heading. For the card long-press popup, where a row per
 * group would push the panel past the height a preview can justify — the colour is what still tells
 * you an "Artist" tag from a "Character" one, and it's the same colour the series page uses.
 *
 * Genres lead, in neutral: they aren't a group and have no colour of their own.
 */
export function TagStrip({
  genres,
  groups,
  contentInset,
  onTagPress,
}: {
  genres?: string[];
  groups?: TagGroup[];
  /** Leading padding inside the scroll content — see `ChipRow`'s `contentInset`. */
  contentInset?: number;
  onTagPress?: (group: TagGroup, index: number) => void;
}) {
  const scheme = useActiveColorScheme();
  // Computed over ALL the groups at once, not per-chip: an unrecognized label's hue depends on which
  // others are present (it probes around them), so the set is the input — see tagPaletteFor.
  const colors = tagPaletteFor(groups?.map((g) => g.label) ?? [], scheme);
  const hasTags = !!genres?.length || !!groups?.some((g) => g.tags.length);
  if (!hasTags) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.hChips, contentInset != null && { paddingLeft: contentInset }]}>
      {genres?.map((g, i) => (
        <Chip key={`g${chipKey(g, i)}`} label={g} />
      ))}
      {groups?.flatMap((group, gi) =>
        groupChips(group, colors[gi]!, `t${gi}:`, onTagPress ? (i) => onTagPress(group, i) : undefined),
      )}
    </ScrollView>
  );
}

export function ChipRow({
  labels,
  accent,
  horizontal,
  contentInset,
}: {
  labels: string[];
  accent?: boolean;
  horizontal?: boolean;
  /** Leading padding inside a `horizontal` row's scroll content, so a full-bleed row (its viewport
   *  spanning to a panel's rounded edges) still rests with breathing room but scrolls content all the
   *  way to the edge rather than clipping it at an inset viewport. */
  contentInset?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxVisible = useMaxVisibleChips();
  if (!labels.length) return null;
  // A single non-wrapping horizontally-scrolling row (used in the card preview panel) — all chips,
  // no collapse (the scroll handles overflow).
  if (horizontal) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.hChips, contentInset != null && { paddingLeft: contentInset }]}>
        {labels.map((l, i) => (
          <Chip key={chipKey(l, i)} label={l} accent={accent} />
        ))}
      </ScrollView>
    );
  }
  const collapsible = !expanded && labels.length > maxVisible;
  const shown = collapsible ? labels.slice(0, maxVisible) : labels;
  return (
    <View style={styles.row}>
      {shown.map((l, i) => (
        <Chip key={chipKey(l, i)} label={l} accent={accent} />
      ))}
      {collapsible && (
        <PressableChip
          testID="chip-row.show-all"
          onPress={() => setExpanded(true)}
          accessibilityLabel="Show all"
          label={`+${labels.length - maxVisible} more`}
        />
      )}
    </View>
  );
}

/**
 * One labelled, wrapping row per tag group (the series page). The CHIPS carry the group's colour —
 * the same one the popup's `TagStrip` gives them when it drops the headings — but the heading itself
 * stays neutral: it already names the group in words, so colouring it too just adds noise to a screen
 * that has the room to spell things out.
 */
export function TagGroupRow({
  group,
  color,
  onTagPress,
  contentInset,
}: {
  group: TagGroup;
  /** This group's colour. Passed in, not derived here: it depends on the OTHER groups in the same
   *  series (see tagPaletteFor), so only the caller — which holds the whole list — can work it out. */
  color: TagColor;
  /** Called with a tapped tag's index. */
  onTagPress?: (index: number) => void;
  /** Leading padding inside the row — see `ChipRow`'s `contentInset`. */
  contentInset?: number;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const maxVisible = useMaxVisibleChips();
  if (!group.tags.length) return null;
  const collapsible = !expanded && group.tags.length > maxVisible;
  const shown = collapsible
    ? { ...group, tags: group.tags.slice(0, maxVisible) }
    : group;
  return (
    <View style={[styles.tagGroup, contentInset != null && { paddingLeft: contentInset }]}>
      <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>{group.label.toUpperCase()}</ThemedText>
      {groupChips(shown, color, '', onTagPress)}
      {collapsible && (
        <PressableChip
          testID={testId('tag-group', group.label, 'show-all')}
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
