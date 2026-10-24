import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { SavedIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BadgePosition, BadgeTone, CardBadge as CardBadgeData } from '@/data/mock';

// Overlay badges on a card cover: bridge-defined `pos-*` / `tone-*` labels plus
// the unread-count pill. Mirrors `.card-badge` / `.badge-unread` in the
// reference web app.

// A bridge may put any number of badges in any corner, and the app adds its own (rank, the
// library marker, unread) to the same corners — so each corner is a stack that lines its badges
// up from the corner inward, never a set of absolutely placed views landing on top of each other.
// The app's own badges lead their corner, so a bridge's can never push them off the cover.
const CORNER: Record<BadgePosition, ViewStyle> = {
  'top-left': { top: Spacing.one, left: Spacing.one, flexDirection: 'row', flexWrap: 'wrap' },
  'top-right': { top: Spacing.one, right: Spacing.one, flexDirection: 'row-reverse', flexWrap: 'wrap' },
  'bottom-left': { bottom: Spacing.one, left: Spacing.one, flexDirection: 'row', flexWrap: 'wrap-reverse' },
  'bottom-right': { bottom: Spacing.one, right: Spacing.one, flexDirection: 'row-reverse', flexWrap: 'wrap-reverse' },
};

const CORNERS = Object.keys(CORNER) as BadgePosition[];

// Mirrors the reference's `.card-badge.tone-*` colors, which are all slightly transparent
// (`rgba(...)`, not solid) — same hex as `theme.badge*`, with the reference's exact alpha per tone.
const TONES: Record<BadgeTone, string> = {
  info: 'rgba(37,99,235,0.88)',
  warn: 'rgba(202,138,4,0.92)',
  success: 'rgba(22,163,74,0.9)',
  neutral: 'rgba(0,0,0,0.68)',
};

export function CardOverlays({
  badges,
  rank,
  saved,
  unread,
}: {
  /** Bridge-defined badges, each stacked in its own corner (top-left when it names none). */
  badges?: readonly CardBadgeData[];
  rank?: number;
  /** The series is in the library. */
  saved?: boolean;
  unread?: number;
}) {
  const stacks: Record<BadgePosition, ReactNode[]> = { 'top-left': [], 'top-right': [], 'bottom-left': [], 'bottom-right': [] };
  if (rank != null) stacks['top-left'].push(<RankBadge key="rank" rank={rank} />);
  if (saved) stacks['top-left'].push(<SavedBadge key="saved" />);
  if (unread != null) stacks['top-right'].push(<UnreadBadge key="unread" count={unread} />);
  badges?.forEach((b, i) => stacks[b.position ?? 'top-left'].push(<CardBadge key={i} badge={b} />));
  return CORNERS.map(
    (corner) =>
      stacks[corner].length > 0 && (
        <View key={corner} style={[styles.stack, CORNER[corner], { pointerEvents: 'none' }]}>
          {stacks[corner]}
        </View>
      ),
  );
}

function CardBadge({ badge }: { badge: CardBadgeData }) {
  return (
    <View style={[styles.badge, styles.lifted, { backgroundColor: TONES[badge.tone ?? 'neutral'] }]}>
      <ThemedText style={styles.badgeText} numberOfLines={1}>
        {badge.text}
      </ThemedText>
    </View>
  );
}

// An icon, not text: bridges can only author text badges, so nothing a bridge sends can be
// mistaken for this one, or imitate it. Exported for the direct-series page grid, where the same
// mark on a page tile says the PAGE is in a collection.
export function SavedBadge({ accessibilityLabel = 'In your library' }: { accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.badge, styles.lifted, styles.saved, { backgroundColor: theme.accent }]}>
      <SavedIcon color={theme.accentOn} size={11} />
    </View>
  );
}

function UnreadBadge({ count }: { count: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.unread, { backgroundColor: theme.badgeInfo }]}>
      <ThemedText style={styles.unreadText}>{count}</ThemedText>
    </View>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <View style={styles.rank}>
      <ThemedText style={styles.rankText}>{rank}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    zIndex: 2,
    alignItems: 'center',
    gap: 3,
    maxWidth: '85%',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    flexShrink: 1,
    minWidth: 0,
  },
  // Mirrors `.card-badge`'s `box-shadow: 0 1px 3px rgba(0,0,0,0.4)` — the
  // language/NEW/HOT tags lift slightly off the cover; the cover itself and
  // the unread pill (`.badge-unread`, no shadow in the reference) don't.
  lifted: {
    boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.4)',
    elevation: 2,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // The same height as a text badge (13 line + 2×2 padding), so a mixed stack lines up.
  saved: {
    height: 17,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  unread: {
    minWidth: 18,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: '#ffffff',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  rank: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  rankText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
});
