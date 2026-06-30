import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxTopLevelWidth, Spacing } from '@/constants/theme';

type PlaceholderScreenProps = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
};

/** Minimal centered placeholder used for the tab screens while they're stubbed out. */
export function PlaceholderScreen({ title, subtitle, children }: PlaceholderScreenProps) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle ?? 'Placeholder — no content yet'}
        </ThemedText>
        {children}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
    // Constrain to the shared top-level content width, centred — matches the
    // browse view so every top-level screen reads at one width.
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
});
