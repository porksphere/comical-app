import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { IS_DEMO_MODE } from '@/data/source';

/**
 * Only rendered on the GitHub Pages preview build (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1`,
 * set in deploy-web.yml), which has no backend to reach from static hosting and
 * renders mock data instead — see `data/source.ts`. Never rendered in a real
 * production build, so mock content is never mistaken for the live app.
 */
export function DemoBanner() {
  const insets = useSafeAreaInsets();
  if (!IS_DEMO_MODE) return null;
  return (
    <View pointerEvents="none" style={[styles.banner, { paddingTop: insets.top + Spacing.one }]}>
      <ThemedText style={styles.text}>Demo preview — sample data, not the live app</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: 'center',
    paddingBottom: Spacing.one,
    backgroundColor: 'rgba(217, 119, 6, 0.92)',
  },
  text: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
