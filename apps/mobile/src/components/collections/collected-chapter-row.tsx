import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import type { ApiCollectionChapterItem } from '@/data/api';
import { useTheme } from '@/hooks/use-theme';

/**
 * One saved chapter in the collected list — full width, not a tile.
 *
 * A chapter has no image of its own: its pages do, but picking one to stand for it would be a lie
 * (and would cost a page-list fetch per chapter just to draw a row). So it renders as text, which
 * is also why `buildCollectedRows` breaks the tile grid around it rather than trying to fit it in.
 */
export function CollectedChapterRow({
  item,
  onPress,
}: {
  item: ApiCollectionChapterItem;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={`collected.chapter.${item.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${item.seriesTitle}${item.chapterName ? `, ${item.chapterName}` : ''}`}>
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {item.chapterName ?? `Chapter ${item.number ?? ''}`.trim()}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {item.seriesTitle}
        </ThemedText>
      </View>
      {item.stale && (
        <ThemedText type="small" numberOfLines={1} style={[styles.stale, { color: theme.danger }]}>
          May no longer be available
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: RowHeight,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    marginBottom: Spacing.three,
  },
  text: {
    flex: 1,
  },
  stale: {
    flexShrink: 0,
    fontSize: 10,
  },
});
