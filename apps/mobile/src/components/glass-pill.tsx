import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useActiveColorScheme } from '@/hooks/use-theme';

/**
 * A capsule of the system's glass hugging whatever is inside it — text, mostly. Liquid Glass where
 * the system has it (iOS 26), a blur of the same shape before that; on Android and web it is the
 * blur too, though nothing there asks for it today.
 *
 * It sizes to its content: put it in a row, or give it `alignSelf`, and it hugs. The padding is
 * the capsule's own breathing room around the text; a caller whose text already carries a gutter
 * pulls the capsule back by the same amount so the text stays where it was.
 */
export function GlassPill({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const scheme = useActiveColorScheme();
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme={scheme} style={[styles.pill, style]}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView tint={scheme} intensity={60} style={[styles.pill, style]}>
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
