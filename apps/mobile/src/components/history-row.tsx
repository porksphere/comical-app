import { Image } from 'expo-image';
import type { RefObject } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MoreVerticalIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useIsDesktop } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { absTime, relTimeLong } from '@/lib/rel-time';
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
 *
 * On desktop the row is wider than it is tall, and lays out accordingly: a larger cover, a bigger
 * title, and the moment (`when`) as a column of its own at the trailing end — relative age over the
 * exact time — rather than the tail of the secondary line, where it was the last and smallest thing
 * in a stack. A phone row has no spare width, so there the caller keeps the age inside `sub`/`detail`
 * and `when` is not drawn.
 */
export function HistoryRow({
  thumbnailUrl,
  title,
  sub,
  detail,
  onPress,
  onPressIn,
  onMore,
  onMorePressIn,
  actions,
  dimmed,
  unread,
  progress,
  when,
  thumbRef,
  coverHidden,
  testID,
}: {
  thumbnailUrl?: string;
  title: string;
  sub?: string;
  /** Tapping the thumbnail/body. */
  onPress: () => void;
  /** Press-DOWN on the same target. The series page measures the thumbnail here, so
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
  /** A second secondary line under `sub` (History's series standing + time). */
  detail?: string;
  /** Pages seen of the chapter being read, 0–1 — a thin bar along the thumbnail's bottom edge.
   *  Omitted while the chapter's length isn't known. */
  progress?: number;
  /** The row's moment (last read / latest chapter), drawn as the desktop time column — see above. */
  when?: number;
  /** Ref on the thumbnail — the anchor for the long-press preview's lift (see SeriesCardMenu). */
  thumbRef?: RefObject<View | null>;
  /** Blank just the thumbnail while this row's long-press menu is open (its lifted preview is a copy). */
  coverHidden?: boolean;
  /** Automation selector for the row. Defaults to `history-row.<title>`; the trailing controls derive
   *  from it (see src/lib/test-id.ts). Pass an explicit id when two rows could share a title. */
  testID?: string;
}) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const resolvedThumb = useResolvedAsset(thumbnailUrl);
  const base = testID ?? testId('history-row', title);
  const thumbStyle = [styles.thumb, desktop && styles.thumbDesktop];
  return (
    <View style={[styles.row, desktop && styles.rowDesktop, dimmed && styles.dimmed]}>
      <Pressable
        testID={base}
        style={[styles.main, desktop && styles.mainDesktop]}
        onPress={onPress}
        onPressIn={onPressIn}
        accessibilityRole="button">
        <View
          ref={thumbRef}
          collapsable={false}
          style={[styles.thumbWrap, desktop && styles.thumbWrapDesktop, coverHidden && styles.thumbHidden]}>
          {resolvedThumb ? (
            <Image
              source={{ uri: resolvedThumb }}
              style={thumbStyle}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={150}
            />
          ) : (
            <View style={[thumbStyle, { backgroundColor: theme.backgroundElement }]} />
          )}
          {progress !== undefined && (
            <View style={styles.progressTrack} testID={testId(base, 'progress')}>
              <View
                style={[styles.progressFill, { backgroundColor: theme.accent, width: `${Math.round(100 * Math.min(1, progress))}%` }]}
              />
            </View>
          )}
        </View>
        <View style={[styles.body, desktop && styles.bodyDesktop]}>
          <View style={styles.titleRow}>
            {unread && <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />}
            <ThemedText type="smallBold" numberOfLines={2} style={[styles.titleText, desktop && styles.titleDesktop]}>
              {title}
            </ThemedText>
          </View>
          {sub ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.sub}>
              {sub}
            </ThemedText>
          ) : null}
          {detail ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.sub}>
              {detail}
            </ThemedText>
          ) : null}
        </View>
        {desktop && when !== undefined && (
          <View style={styles.when} testID={testId(base, 'when')}>
            <ThemedText type="small" numberOfLines={1}>
              {relTimeLong(when)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {absTime(when)}
            </ThemedText>
          </View>
        )}
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
/** Desktop: the row has the width for a cover one can actually recognise. */
const THUMB_W_DESKTOP = 72;

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
  rowDesktop: {
    gap: Spacing.four,
    paddingVertical: Spacing.three,
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
  mainDesktop: {
    gap: Spacing.four,
  },
  thumbWrap: {
    width: THUMB_W,
  },
  thumbWrapDesktop: {
    width: THUMB_W_DESKTOP,
  },
  thumb: {
    width: THUMB_W,
    aspectRatio: 2 / 3,
    ...ContinuousCorner,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  thumbDesktop: {
    width: THUMB_W_DESKTOP,
  },
  // Inset from the cover's rounded edge rather than clipped by it, so the fill never has to agree
  // with the corner's curve — and the track reads over any cover, light or dark.
  progressTrack: {
    position: 'absolute',
    left: 3,
    right: 3,
    bottom: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  bodyDesktop: {
    gap: Spacing.one,
  },
  titleDesktop: {
    fontSize: 16,
    lineHeight: 22,
  },
  // Right-aligned so the ages line up down the list, and wide enough that "just now" over
  // "Sep 30, 11:48 PM" never wraps or shifts the column between rows.
  when: {
    alignItems: 'flex-end',
    minWidth: 128,
    flexShrink: 0,
    gap: Spacing.half,
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
    ...ContinuousCorner,
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
