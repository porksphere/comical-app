import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Stat } from '@/data/mock';

// Inline stat line (rating / follows / views …). Mirrors `.meta-stats` in the
// reference: a wrapping row of value + muted label pairs.

export function StatsRow({ stats }: { stats: Stat[] }) {
  if (!stats.length) return null;
  return (
    <View style={styles.row}>
      {stats.map((s) => (
        <View key={s.id} style={styles.stat}>
          <ThemedText type="smallBold">{s.value}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {s.label}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
});
