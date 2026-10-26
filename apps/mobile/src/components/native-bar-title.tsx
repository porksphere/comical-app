import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';

/**
 * The iOS navigation bar's title slot holding the custom bar's cluster — thumbnail, name ▾ — in place
 * of a title. The title slot is the one place in the bar UIKit never wraps in a Liquid Glass capsule
 * (every leading/trailing item is a bar button item and gets one), so the cluster reads as it does in
 * the custom bar: a picture and plain text with a caret, with only the real buttons beside it as
 * glass. Centred, because that is where the bar puts its title.
 */
export function NativeBarTitle({ children }: { children: ReactNode }) {
  return (
    <Stack.Title asChild>
      <View style={styles.row}>{children}</View>
    </Stack.Title>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    // The bar hands the title view the width left between its items; the labels inside shrink and
    // truncate to it rather than the row overflowing them.
    flexShrink: 1,
    minWidth: 0,
  },
});
