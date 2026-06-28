import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';

import { CardBadge, UnreadBadge } from '@/components/card-badge';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { coverDelayMs, type SeriesEntry } from '@/data/mock';
import { useIsCompact } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

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
// Card title metrics mirror the reference's `.card-title`: 0.85rem desktop /
// 0.8rem mobile (1rem = 16px), line-height 1.3 (rounded to whole px).
const TITLE_FONT_SIZE = { regular: 13.6, compact: 12.8 };
const TITLE_LINE_HEIGHT = { regular: 18, compact: 17 };

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
  index = 0,
  onPeekChange,
}: {
  entry: SeriesEntry;
  size?: CardSize;
  rank?: number;
  /** Explicit card width (rails compute a responsive one); falls back to the
   *  per-size default. `grid` cards ignore this and fill their column. */
  width?: number;
  /** Card position in its rail — used by the rail to place the lifted popover. */
  index?: number;
  /** When provided (rail mode), the card reports its peek state up instead of
   *  drawing its own popover, so the rail can render it OUTSIDE the clipping
   *  horizontal scroller. The grid omits this and draws the popover in-card. */
  onPeekChange?: (show: boolean, index: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const { active, handlers } = useHeld();
  const fixedWidth = size === 'grid' ? undefined : (width ?? WIDTHS[size]);

  // Responsive title size matching the reference's mobile/desktop type scale.
  const compact = useIsCompact();
  const titleFontSize = compact ? TITLE_FONT_SIZE.compact : TITLE_FONT_SIZE.regular;
  const titleLineHeight = compact ? TITLE_LINE_HEIGHT.compact : TITLE_LINE_HEIGHT.regular;
  const titleSize = { fontSize: titleFontSize, lineHeight: titleLineHeight };

  // Hold some covers behind a simulated network delay: we don't even mount the
  // <Image> until the delay elapses, so the skeleton stays visible (a stand-in
  // for real bridge image latency). Most covers are instant.
  const delay = useMemo(() => coverDelayMs(entry.id), [entry.id]);
  const [delayPassed, setDelayPassed] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    setDelayPassed(false);
    setLoaded(false);
    const t = setTimeout(() => setDelayPassed(true), delay);
    return () => clearTimeout(t);
  }, [delay, entry.id]);
  const coverReady = delayPassed && loaded;

  // Full-title peek. In a rail, hand the show/hide up to the rail (it owns the
  // un-clipped popover); in the grid, render it in-card (the vertical list
  // doesn't clip downward overflow).
  const showPeek = active && truncated;
  const onPeekRef = useRef(onPeekChange);
  onPeekRef.current = onPeekChange;
  useEffect(() => {
    onPeekRef.current?.(showPeek, index);
  }, [showPeek, index]);
  // Stop reporting if the card unmounts while peeking (rail recycle/scroll).
  useEffect(() => () => onPeekRef.current?.(false, index), [index]);

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
            {delayPassed && (
              <Image
                source={{ uri: entry.cover }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                onLoad={() => setLoaded(true)}
              />
            )}
            {!coverReady && <Skeleton style={StyleSheet.absoluteFill} />}
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
          <ThemedText type="small" numberOfLines={MAX_TITLE_LINES} style={[styles.title, titleSize]}>
            {entry.title}
          </ThemedText>
          {/* Off-screen full-height copy measured via onLayout (which, unlike
              onTextLayout, fires on react-native-web) to detect clamping. */}
          <ThemedText
            type="small"
            style={[styles.title, titleSize, styles.measure]}
            onLayout={(e) =>
              setTruncated(e.nativeEvent.layout.height > MAX_TITLE_LINES * titleLineHeight + 1)
            }>
            {entry.title}
          </ThemedText>
          {/* Grid-only in-card popover (rails render it at the rail level). */}
          {!onPeekChange && showPeek && <TitlePeek title={entry.title} />}
        </View>
      </Pressable>
    </Link>
  );
}

/**
 * The full-title popover. Used in-card by the grid and lifted out of the
 * scroller by the rail (which passes a positioning `style`). Its content box
 * matches the clamped title width so the first lines wrap identically.
 */
export function TitlePeek({
  title,
  style,
}: {
  title: string;
  // Accepts plain styles (grid, in-card) or a reanimated style (rail, the
  // UI-thread scroll transform).
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
}) {
  const theme = useTheme();
  // Match the card title's responsive size so the popover wraps identically.
  const compact = useIsCompact();
  const titleSize = {
    fontSize: compact ? TITLE_FONT_SIZE.compact : TITLE_FONT_SIZE.regular,
    lineHeight: compact ? TITLE_LINE_HEIGHT.compact : TITLE_LINE_HEIGHT.regular,
  };
  // Animated.View so the rail can hand it a UI-thread transform that tracks the
  // strip's scroll (the grid passes a plain style and it renders unchanged).
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.titlePopover, { backgroundColor: theme.backgroundElement }, style]}>
      <ThemedText type="small" style={[styles.title, titleSize]}>
        {title}
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    // A touch more breathing room between the thumbnail and its title.
    gap: Spacing.two,
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
    // Expand slightly past the card: insets equal the horizontal padding, so the
    // text column lines up with the clamped title and wraps identically (no word
    // reflow), while the box reads as a popover lifting off the card.
    top: -Spacing.one,
    left: -Spacing.two,
    right: -Spacing.two,
    zIndex: 1000,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 8,
    // Soft lift so it reads as floating over the cards below it.
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
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
