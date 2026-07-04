import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A single action on a row (Resume / Remove / Read …). */
export type RowAction = {
  label: string;
  onPress: () => void;
  /** Muted styling for a secondary/destructive action (e.g. Remove). */
  ghost?: boolean;
};

/**
 * A horizontal list row shared by the History and Activity tabs: a small cover
 * thumbnail, a two-line title + secondary line, and a trailing group of compact
 * action buttons. Tapping the thumbnail/body opens the series (`onOpen`). Mirrors
 * comical-web's `.history-item` rows so both feeds read the same on every
 * platform.
 */
export function HistoryRow({
  thumbnailUrl,
  title,
  sub,
  onOpen,
  actions,
  dimmed,
}: {
  thumbnailUrl?: string;
  title: string;
  sub?: string;
  onOpen: () => void;
  actions: RowAction[];
  /** Render at reduced opacity (an already-read activity item). */
  dimmed?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, dimmed && styles.dimmed]}>
      <Pressable style={styles.main} onPress={onOpen} accessibilityRole="button">
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
});
