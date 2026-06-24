import { GlassView } from 'expo-glass-effect';
import { StyleSheet } from 'react-native';
import { ScrollView } from 'react-native';

import { greet } from '@porksphere/core';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function DetailScreen() {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}>
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle">Pushed via native stack</ThemedText>
        <ThemedText themeColor="textSecondary">
          This screen is presented by the platform navigation controller, so it
          gets the native large-title header and back gesture for free.
        </ThemedText>

        {/* Liquid Glass surface. Renders the native iOS 26 glass material;
            automatically falls back to a plain opaque view on Android and
            iOS < 26. */}
        <GlassView style={styles.glass} glassEffectStyle="regular">
          <ThemedText type="smallBold" style={styles.glassLabel}>
            Liquid Glass (iOS 26)
          </ThemedText>
        </GlassView>

        <ThemedView type="backgroundElement" style={styles.coreBox}>
          <ThemedText type="small" themeColor="textSecondary">
            value from the business-logic core
          </ThemedText>
          <ThemedText type="code">{greet('Comical')}</ThemedText>
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  container: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.four,
  },
  glass: {
    height: 120,
    borderRadius: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassLabel: {
    textAlign: 'center',
  },
  coreBox: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Spacing.four,
  },
});
