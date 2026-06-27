import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

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
// badges, and a clamped title that reveals in full while active.

export type CardSize = 'grid' | 'rail' | 'ranked' | 'hero';

const WIDTHS: Record<Exclude<CardSize, 'grid'>, number> = {
  rail: 130,
  ranked: 150,
  hero: 240,
};

const MAX_TITLE_LINES = 2;
const TITLE_LINE_HEIGHT = 18;

// Large enough to cover any screen: the press stays "active" wherever the finger
// goes, so the highlight only ends on release.
const HOLD_RETENTION = { top: 1000, bottom: 1000, left: 1000, right: 1000 };

/**
 * Held-highlight state. A press/touch "holds" the card active; on the web the
 * hold is only released by an actual pointer/touch *release* anywhere on the
 * page — moving the finger or scrolling does NOT end it (a scroll isn't a
 * finger-up). Mouse hover holds it too. Native falls back to press in/out with a
 * large press-retention offset so sliding off the card keeps it active.
 */
function useHeld() {
  const [held, setHeld] = useState(false);
  const [hovered, setHovered] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);

  const start = useCallback(() => {
    setHeld(true);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      cleanup.current?.();
      const release = () => {
        setHeld(false);
        window.removeEventListener('pointerup', release);
        window.removeEventListener('touchend', release);
        window.removeEventListener('mouseup', release);
        cleanup.current = null;
      };
      // Only true finger/mouse releases end the hold — deliberately NOT
      // pointercancel/touchcancel, so a scroll keeps the card highlighted.
      window.addEventListener('pointerup', release);
      window.addEventListener('touchend', release);
      window.addEventListener('mouseup', release);
      cleanup.current = release;
    }
  }, []);

  const end = useCallback(() => {
    // On the web the global release listener owns teardown; on native, press-out
    // is the release.
    if (Platform.OS !== 'web') setHeld(false);
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  return {
    active: held || hovered,
    handlers: {
      onPressIn: start,
      onPressOut: end,
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
    },
  };
}

export function SeriesCard({
  entry,
  size = 'grid',
  rank,
  width,
}: {
  entry: SeriesEntry;
  size?: CardSize;
  rank?: number;
  /** Explicit card width (rails compute a responsive one); falls back to the
   *  per-size default. `grid` cards ignore this and fill their column. */
  width?: number;
}) {
  const theme = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const { active, handlers } = useHeld();
  const fixedWidth = size === 'grid' ? undefined : (width ?? WIDTHS[size]);

  return (
    <Link
      href={{ pathname: '/series', params: { id: entry.id, title: entry.title } }}
      asChild>
      {/* Flatten to a single style object: as the `asChild` of <Link>, the
          Pressable is cloned by expo-router's <Slot>, which rejects array styles. */}
      <Pressable
        style={StyleSheet.flatten([
          styles.card,
          fixedWidth != null && { width: fixedWidth },
          // Lift the active card so its full-title popover draws over neighbours.
          active && styles.cardActive,
        ])}
        // Native: sliding off the card keeps it held; release clears it.
        pressRetentionOffset={HOLD_RETENTION}
        {...handlers}>
        {/* Shell carries the cover's size so the highlight ring can sit OUTSIDE
            the (overflow-clipped) cover without insetting it. */}
        <View style={styles.coverShell}>
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
          </View>
          {/* Highlight ring hugs the cover edge (flush, just outside) — only
              visible while active. */}
          {active && <View pointerEvents="none" style={styles.ring} />}
        </View>

        <View style={styles.titleWrap}>
          <ThemedText type="small" numberOfLines={MAX_TITLE_LINES} style={styles.title}>
            {entry.title}
          </ThemedText>
          {/* Off-screen full-height copy measured via onLayout (which, unlike
              onTextLayout, fires on react-native-web) to detect clamping. */}
          <ThemedText
            type="small"
            style={[styles.title, styles.measure]}
            onLayout={(e) =>
              setTruncated(e.nativeEvent.layout.height > MAX_TITLE_LINES * TITLE_LINE_HEIGHT + 1)
            }>
            {entry.title}
          </ThemedText>
          {/* Reveal the full title in a popover while active and clamped, so a long
              title doesn't reflow the row (mirrors `.clampable::after`). */}
          {active && truncated && (
            <View
              pointerEvents="none"
              style={[
                styles.titlePopover,
                { backgroundColor: theme.backgroundElement, borderColor: theme.hairline },
              ]}>
              <ThemedText type="small" style={styles.title}>
                {entry.title}
              </ThemedText>
            </View>
          )}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.one,
  },
  cardActive: {
    zIndex: 10,
  },
  coverShell: {
    width: '100%',
    aspectRatio: 2 / 3,
    position: 'relative',
  },
  cover: {
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  ring: {
    position: 'absolute',
    // Offset == border width, so the ring's inner edge is flush with the cover
    // (no gap) while the stroke itself sits just outside it.
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#60a5fa',
  },
  titleWrap: {
    position: 'relative',
  },
  title: {
    fontWeight: '600',
    lineHeight: TITLE_LINE_HEIGHT,
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
    zIndex: -1,
  },
  titlePopover: {
    position: 'absolute',
    top: -Spacing.one,
    left: -Spacing.one,
    right: -Spacing.one,
    zIndex: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 8,
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
