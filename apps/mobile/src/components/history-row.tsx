import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { MoreVerticalIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
  onMore,
  actions,
  dimmed,
}: {
  thumbnailUrl?: string;
  title: string;
  sub?: string;
  /** Tapping the thumbnail/body. */
  onPress: () => void;
  /** When set, a trailing 3-dot button (e.g. History → open the series page). */
  onMore?: () => void;
  actions: RowAction[];
  /** Render at reduced opacity (an already-read activity item). */
  dimmed?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, dimmed && styles.dimmed]}>
      <Pressable style={styles.main} onPress={onPress} accessibilityRole="button">
        <View style={styles.thumbWrap}>
          {thumbnailUrl ? (
            <Image
              source={{ uri: thumbnailUrl }}
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
          <ThemedText type="smallBold" numberOfLines={2}>
            {title}
          </ThemedText>
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
            onPress={onMore}
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
  },
  dimmed: {
    opacity: 0.55,
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
