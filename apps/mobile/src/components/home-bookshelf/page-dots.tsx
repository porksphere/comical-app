import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { NativePageDots } from '../../../modules/page-dots';

export const PAGE_DOTS_HEIGHT = 26;

/**
 * Which book of the shelf is in front, as a row of dots. On iOS they are the system's page control,
 * which also takes a tap or a scrub; elsewhere they only tell, the shelf itself being what is
 * dragged and tapped.
 */
export function PageDots({ count, page, onPage }: { count: number; page: number; onPage: (page: number) => void }) {
  const theme = useTheme();
  if (NativePageDots) {
    return <NativePageDots style={styles.row} count={count} page={page} onPage={(event) => onPage(event.nativeEvent.page)} />;
  }
  if (count < 2) return <View style={styles.row} />;
  return (
    <View style={[styles.row, styles.dots]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, { backgroundColor: theme.text, opacity: i === page ? 0.9 : 0.22 }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: PAGE_DOTS_HEIGHT, alignSelf: 'stretch' },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
