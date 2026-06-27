import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardBadge, UnreadBadge } from '@/components/card-badge';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SeriesEntry } from '@/data/mock';

// Shared cover card used by both the browse grid and the rails. `size` picks the
// fixed rail widths; `grid` fills its parent slot (the grid controls columns).
// Mirrors `.card` in the reference: a chrome-less cover (2:3, radius 10) that
// shows a highlight ring only on hover (web) or while held (touch), overlaid
// badges, a clamped title that reveals in full while active, and a subtitle.

export type CardSize = 'grid' | 'rail' | 'ranked' | 'hero';

const WIDTHS: Record<Exclude<CardSize, 'grid'>, number> = {
  rail: 130,
  ranked: 150,
  hero: 240,
};

export function SeriesCard({
  entry,
  size = 'grid',
  rank,
}: {
  entry: SeriesEntry;
  size?: CardSize;
  rank?: number;
}) {
  const theme = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const fixedWidth = size === 'grid' ? undefined : WIDTHS[size];
  const maxLines = size === 'grid' ? 3 : 2;
  // Highlight (ring + full-title reveal) while hovered on web or held on touch —
  // the cross-platform stand-in for the reference's :hover / .touch-active.
  const active = hovered || pressed;

  return (
    <Link
      href={{ pathname: '/series', params: { id: entry.id, title: entry.title } }}
      asChild>
      {/* Flatten to a single style object: as the `asChild` of <Link>, the
          Pressable is cloned by expo-router's <Slot>, which rejects array styles. */}
      <Pressable
        style={StyleSheet.flatten([styles.card, fixedWidth != null && { width: fixedWidth }])}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}>
        <View style={styles.cover}>
          <Image
            source={{ uri: entry.cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            onLoad={() => setLoaded(true)}
          />
          {!loaded && <Skeleton style={StyleSheet.absoluteFill} />}
          {entry.badges?.map((b, i) => <CardBadge key={i} badge={b} />)}
          {entry.unread != null && <UnreadBadge count={entry.unread} />}
          {rank != null && (
            <View style={styles.rank}>
              <ThemedText style={styles.rankText}>{rank}</ThemedText>
            </View>
          )}
          {/* Highlight ring drawn on top so it never insets the cover (no layout
              shift) — only visible while active. */}
          {active && <View pointerEvents="none" style={styles.ring} />}
        </View>

        <View style={styles.titleWrap}>
          <ThemedText
            type="small"
            numberOfLines={maxLines}
            onTextLayout={(e) => {
              const text = e.nativeEvent.lines.map((l) => l.text).join('');
              setTruncated(text.length > 0 && text.length < entry.title.length);
            }}
            style={styles.title}>
            {entry.title}
          </ThemedText>
          {/* Reveal the full title in a popover while active and clamped, so a long
              title doesn't reflow the row (mirrors `.clampable::after`). */}
          {active && truncated && (
            <View
              pointerEvents="none"
              style={[styles.titlePopover, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" style={styles.title}>
                {entry.title}
              </ThemedText>
            </View>
          )}
        </View>

        {entry.sub ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.sub}>
            {entry.sub}
          </ThemedText>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.one,
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#60a5fa',
  },
  titleWrap: {
    position: 'relative',
  },
  title: {
    fontWeight: '600',
    lineHeight: 18,
  },
  titlePopover: {
    position: 'absolute',
    top: -Spacing.one,
    left: -Spacing.one,
    right: -Spacing.one,
    zIndex: 10,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
    borderRadius: 6,
  },
  sub: {
    fontSize: 12,
    lineHeight: 16,
  },
  rank: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 2,
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
