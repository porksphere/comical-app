import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BadgePosition, BadgeTone, CardBadge as CardBadgeData } from '@/data/mock';

// Overlay badges on a card cover: bridge-defined `pos-*` / `tone-*` labels plus
// the unread-count pill. Mirrors `.card-badge` / `.badge-unread` in the
// reference web app.

const POS: Record<BadgePosition, object> = {
  'top-left': { top: Spacing.one, left: Spacing.one },
  'top-right': { top: Spacing.one, right: Spacing.one },
  'bottom-left': { bottom: Spacing.one, left: Spacing.one },
  'bottom-right': { bottom: Spacing.one, right: Spacing.one },
};

export function CardBadge({ badge }: { badge: CardBadgeData }) {
  // Mirrors the reference's `.card-badge.tone-*` colors, which are all
  // slightly transparent (`rgba(...)`, not solid) — same hex as `theme.badge*`,
  // with the reference's exact alpha per tone.
  const tones: Record<BadgeTone, string> = {
    info: 'rgba(37,99,235,0.88)',
    warn: 'rgba(202,138,4,0.92)',
    success: 'rgba(22,163,74,0.9)',
    neutral: 'rgba(0,0,0,0.68)',
  };
  return (
    <View
      pointerEvents="none"
      style={[
        styles.badge,
        POS[badge.position ?? 'top-left'],
        { backgroundColor: tones[badge.tone ?? 'neutral'] },
      ]}>
      <ThemedText style={styles.badgeText} numberOfLines={1}>
        {badge.text}
      </ThemedText>
    </View>
  );
}

export function UnreadBadge({ count }: { count: number }) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={[styles.unread, { backgroundColor: theme.badgeInfo }]}>
      <ThemedText style={styles.unreadText}>{count}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    zIndex: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    maxWidth: '85%',
    // Mirrors `.card-badge`'s `box-shadow: 0 1px 3px rgba(0,0,0,0.4)` — the
    // language/NEW/HOT tags lift slightly off the cover; the cover itself and
    // the unread pill (`.badge-unread`, no shadow in the reference) don't.
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  unread: {
    position: 'absolute',
    zIndex: 2,
    top: Spacing.two,
    right: Spacing.two,
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
});
