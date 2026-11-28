import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { BridgeThumb } from '@/components/bridge-thumb';
import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { useOptionThumbBox } from '@/components/selector';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Bridge } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * The search tab's landing, before anything is typed: the sources, each a tap away from being what
 * the search looks in. The scope menu in the bar does the same; this is where it can be seen. Each
 * row's tile is the one the source menus show (`useOptionThumbBox`).
 */
export function SearchSources({ bridges, onSelect }: { bridges: readonly Bridge[]; onSelect: (id: string) => void }) {
  const theme = useTheme();
  const thumb = useOptionThumbBox();
  if (bridges.length === 0) return null;
  return (
    <View style={styles.section}>
      {bridges.map((b) => (
        <Pressable
          key={b.id}
          testID={`search.source.${b.id}`}
          onPress={() => onSelect(b.id)}
          accessibilityRole="button"
          accessibilityLabel={`Search ${b.name}`}
          style={({ pressed }) => [styles.row, { borderBottomColor: theme.barHairline }, pressed && styles.pressed]}>
          <BridgeThumb uri={b.thumbnail} label={b.name} size={thumb.size} style={thumb.style} />
          <ThemedText numberOfLines={1} style={styles.name}>
            {b.name}
          </ThemedText>
          <ChevronRightIcon color={theme.textSecondary} size={17} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
  },
  name: {
    flex: 1,
    fontSize: 17,
  },
  pressed: { opacity: 0.6 },
});
