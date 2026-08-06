import { Image } from 'expo-image';
import type { RefObject } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MoreVerticalIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

/** A single action on a row (Read / Read again …). */
export type RowAction = {
  label: string;
  onPress: () => void;
  /** Muted styling for a secondary action. */
  ghost?: boolean;
};

/**
 * A horizontal list row shared by the History and Activity tabs: a small cover thumbnail, a two-line
 * title + secondary line, and a trailing group of compact controls. Tapping the thumbnail/body runs
 * `onPress` (History resumes; Activity opens the series). Optional trailing text `actions` (Activity's
 * "Read") and/or a 3-dot `onMore` button (History's "open the series page"). Mirrors comical-web's
 * `.history-item` rows so both feeds read the same on every platform.
 */
export function HistoryRow({
  thumbnailUrl,
  title,
  sub,
  onPress,
  onPressIn,
  onMore,
  onMorePressIn,
  actions,
  dimmed,
  unread,
  thumbRef,
  coverHidden,
  testID,
}: {
  thumbnailUrl?: string;
  title: string;
  sub?: string;
  /** Tapping the thumbnail/body. */
  onPress: () => void;
  /** Press-DOWN on the same target. The series-reader experiment measures the thumbnail here, so
   *  the zoom transition has its source rect before navigation rather than a frame after it. */
  onPressIn?: () => void;
  /** When set, a trailing 3-dot button (e.g. History → open the series page). */
  onMore?: () => void;
  /** Press-DOWN on that button — same reason as `onPressIn`: the zoom transition needs the
   *  thumbnail's rect measured before navigation, not a frame after it. */
  onMorePressIn?: () => void;
  actions: RowAction[];
  /** Render at reduced opacity (an already-read activity item). */
  dimmed?: boolean;
  /** Accent dot before the title (an unread activity item). */
  unread?: boolean;
  /** Ref on the thumbnail — the anchor for the long-press preview's lift (see SeriesCardMenu). */
  thumbRef?: RefObject<View | null>;
  /** Blank just the thumbnail while this row's long-press menu is open (its lifted preview is a copy). */
  coverHidden?: boolean;
  /** Automation selector for the row. Defaults to `history-row.<title>`; the trailing controls derive
   *  from it (see src/lib/test-id.ts). Pass an explicit id when two rows could share a title. */
  testID?: string;
}) {
  const theme = useTheme();
  const resolvedThumb = useResolvedAsset(thumbnailUrl);
  const base = testID ?? testId('history-row', title);
  return (
    <View style={[styles.row, dimmed && styles.dimmed]}>
      <Pressable
        testID={base}
        style={styles.main}
        onPress={onPress}
        onPressIn={onPressIn}
        accessibilityRole="button">
        <View ref={thumbRef} collapsable={false} style={[styles.thumbWrap, coverHidden && styles.thumbHidden]}>
          {resolvedThumb ? (
            <Image
              source={{ uri: resolvedThumb }}
              style={styles.thumb}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={150}
            />
          ) : (
            <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]} />
          )}
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            {unread && <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />}
            <ThemedText type="smallBold" numberOfLines={2} style={styles.titleText}>
              {title}
            </ThemedText>
          </View>
          {sub ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.sub}>
              {sub}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            testID={testId(base, a.label)}
            onPress={a.onPress}
            accessibilityRole="button"
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
            <ThemedView type={a.ghost ? undefined : 'backgroundElement'} style={styles.btnFill}>
              <ThemedText type="small" themeColor={a.ghost ? 'textSecondary' : undefined} style={styles.btnLabel}>
                {a.label}
              </ThemedText>
            </ThemedView>
          </Pressable>
        ))}
        {onMore && (
          <Pressable
            testID={testId(base, 'more')}
            onPress={onMore}
            onPressIn={onMorePressIn}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Open series"
            style={({ pressed }) => [styles.moreBtn, pressed && styles.pressed]}>
            <MoreVerticalIcon color={theme.textSecondary} size={20} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const THUMB_W = 46;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    // Own the horizontal gutter (rather than the list padding it) so the row itself spans the full
    // content width — the swipe-to-delete then reaches the screen edge instead of being cut off inside
    // a side inset. The list only pads the centring inset (web); see history/activity.
    paddingHorizontal: Spacing.four,
  },
  dimmed: {
    opacity: 0.55,
  },
  thumbHidden: {
    opacity: 0,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minWidth: 0,
  },
  thumbWrap: {
    width: THUMB_W,
  },
  thumb: {
    width: THUMB_W,
    aspectRatio: 2 / 3,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titleText: {
    flexShrink: 1,
    minWidth: 0,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  sub: {
    // Slightly tighter than the title→sub default so the row stays compact.
    marginTop: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 0,
  },
  btn: {
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.7,
  },
  btnFill: {
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: {
    fontWeight: '600',
  },
  moreBtn: {
    padding: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
