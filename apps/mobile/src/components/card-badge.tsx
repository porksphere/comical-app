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
  const theme = useTheme();
  const tones: Record<BadgeTone, string> = {
    info: theme.badgeInfo,
    warn: theme.badgeWarn,
    success: theme.badgeSuccess,
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
