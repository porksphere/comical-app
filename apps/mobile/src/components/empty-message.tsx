import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTitleFont } from '@/lib/title-font';

/** A screen with nothing in it yet: a headline in the title typeface and what would fill it. */
export function EmptyMessage({ title, detail, style }: { title: string; detail: string; style?: StyleProp<ViewStyle> }) {
  const font = useTitleFont();
  return (
    <View style={[styles.empty, style]}>
      <ThemedText style={[styles.title, font && { fontFamily: font, fontWeight: 'normal' }]}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.detail}>
        {detail}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  detail: {
    textAlign: 'center',
    maxWidth: 320,
  },
});
