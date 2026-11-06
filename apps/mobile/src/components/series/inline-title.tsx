import { createContext, use, type ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { NATIVE_HEADER } from '@/hooks/use-native-header';

/** Where the series page wants to know how tall its title came out, wrapped lines included. */
export const InlineTitleHeightContext = createContext<SharedValue<number> | null>(null);

/**
 * The series' title at the top of the page's list. Under the system bar it is the page's large
 * title, the bar taking a small centred one as this scrolls under it (SeriesDetailsNativeBar).
 */
export function InlineSeriesTitle({ style, ...props }: ComponentProps<typeof ThemedText>) {
  const height = use(InlineTitleHeightContext);
  return (
    <ThemedText
      {...props}
      style={[style, NATIVE_HEADER && styles.large]}
      onLayout={height ? (e) => height.set(e.nativeEvent.layout.height) : undefined}
    />
  );
}

const styles = StyleSheet.create({
  // The page's own heading, a step under UIKit's 34pt large title the tabs carry in their bars.
  large: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.3 },
});
