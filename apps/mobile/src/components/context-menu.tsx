/**
 * The app's shared context-menu building blocks — the styling every long-press / 3-dot menu renders
 * with, extracted from the series card menu so new menus (chapter rows, future batch actions) look
 * and behave identically. Rendered inside the app overlay (bottom sheet on phones, anchored popover
 * on desktop); the rich native card popup (series-card-context-menu.tsx) draws its own material but
 * mirrors these row metrics.
 *
 *  - `MenuHeader` — the identity block above the rows: an optional cover thumb + full (unclamped)
 *    title, the reveal a long-press affords when the source's own title is clamped.
 *  - `MenuActionRow` — icon + label row: hover highlight, accent tint + trailing dot when `active`,
 *    dimmed-inert for `loading`/`disabled`, optional muted `detail` (e.g. "12 chapters").
 */
import { Image } from 'expo-image';
import { useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import type { AnchorRect } from '@/components/overlay/overlay';
import type { IconProps } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { RowHeight, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';

/**
 * The shared hold-to-open behavior, platform-split the same way the series card menu is:
 *
 *  - **native** — a gesture-handler `LongPress` wraps the content. NOT a `Pressable`'s
 *    `onLongPress`: inside a scrolling list on iOS that doesn't fire reliably (the touch is routed
 *    to the scroll view; see series-card-menu.tsx, which learned this first). GH recognizes the
 *    hold at the native layer, cancels the child's press responder when it fires, and any finger
 *    travel before the hold elapses loses to the scroll.
 *  - **web** — the child's own `onLongPress` (handed through the render prop), because RNW routes
 *    the release to whichever Pressable grabbed the touch — a wrapping gesture can't suppress the
 *    child's click, but RNW's Pressable suppresses its OWN press after its long-press fires.
 *
 * `onHold` receives the PRESS POINT as a zero-size anchor rect, so the menu can open as a popover
 * floating at the finger (the classic context-menu placement) instead of a bottom sheet.
 */
export function Holdable({
  enabled = true,
  onHold,
  children,
}: {
  enabled?: boolean;
  onHold: (anchor?: AnchorRect) => void;
  /** Render prop: spread `onLongPress` onto the row's own Pressable (it's undefined on native,
   *  where the wrapping gesture detects the hold instead). */
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void }) => ReactNode;
}) {
  // `runOnJS(true)`: the handler is a plain JS callback, so no worklet/ref plumbing. A changed
  // handler re-configures the recognizer in place (GestureDetector diffs), which is cheap.
  const gesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(350)
        .runOnJS(true)
        .enabled(enabled && Platform.OS !== 'web')
        .onStart((e) => onHold({ x: e.absoluteX, y: e.absoluteY, width: 0, height: 0 })),
    [enabled, onHold],
  );
  if (Platform.OS === 'web') {
    return (
      <>
        {children({
          onLongPress: enabled
            ? (e) => onHold({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0 })
            : undefined,
        })}
      </>
    );
  }
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false}>{children({})}</View>
    </GestureDetector>
  );
}

/** Cover thumbnail + full (unclamped) title. Omit `cover` AND pass `textOnly` for cover-less
 *  subjects (a chapter, a list) — the thumb column disappears instead of showing a placeholder. */
export function MenuHeader({
  title,
  cover,
  coverAspect,
  textOnly,
}: {
  title: string;
  cover?: string;
  coverAspect?: number;
  /** No cover slot at all (vs. `cover` merely missing, which shows a placeholder block). */
  textOnly?: boolean;
}) {
  const aspect = clampThumbAspect(coverAspect ?? DEFAULT_THUMB_ASPECT);
  const coverW = 48;
  const coverH = coverW / aspect;
  return (
    <View style={styles.header}>
      {!textOnly &&
        (cover ? (
          <Image
            source={{ uri: cover }}
            style={[styles.headerCover, { width: coverW, height: coverH }]}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.headerCover, styles.headerCoverEmpty, { width: coverW, height: coverH }]} />
        ))}
      <ThemedText style={styles.headerTitle} numberOfLines={3}>
        {title}
      </ThemedText>
    </View>
  );
}

export function MenuActionRow({
  label,
  Icon,
  loading,
  disabled,
  active,
  detail,
  onPress,
  testID,
}: {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** Status still resolving — row is dimmed and inert. */
  loading?: boolean;
  /** Unavailable (e.g. favorites need a login that isn't set) — dimmed and inert, but not "loading". */
  disabled?: boolean;
  /** Currently favorited / in library / downloaded — tints the row with the accent and shows a trailing dot. */
  active?: boolean;
  /** Muted trailing text (e.g. a chapter count). Replaced by the active dot when `active`. */
  detail?: string;
  onPress: () => void;
  /** Automation selector — required so every action row is reachable (see src/lib/test-id.ts). */
  testID: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const inert = !!loading || !!disabled;
  const color = inert ? theme.textSecondary : active ? theme.accent : theme.text;
  return (
    <Pressable
      testID={testID}
      onPress={inert ? undefined : onPress}
      disabled={inert}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && !inert && { backgroundColor: theme.backgroundSelected }, inert && styles.rowInert]}>
        <Icon color={color} size={18} />
        <ThemedText style={[styles.rowLabel, { color }]} numberOfLines={1}>
          {label}
        </ThemedText>
        {active ? (
          <View style={[styles.stateDot, { backgroundColor: theme.accent }]} />
        ) : detail ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {detail}
          </ThemedText>
        ) : null}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.one,
  },
  headerCover: {
    borderRadius: 8,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  headerCoverEmpty: {
    backgroundColor: 'rgba(128,128,128,0.2)',
  },
  headerTitle: {
    flex: 1,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: RowHeight,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowInert: {
    opacity: 0.5,
  },
  rowLabel: {
    flex: 1,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
