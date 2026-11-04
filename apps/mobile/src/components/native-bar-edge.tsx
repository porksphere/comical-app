import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { NATIVE_HEADER } from '@/hooks/use-native-header';

import { NavBarEdge } from '../../modules/nav-bar-edge';

/**
 * How far the screen's system bar has slid away (0 at rest, minus its height once gone), as a
 * sticky section's `barOffset`: the label a tab's bar shows changes as a heading passes the bar's
 * edge where it is, not where it rests, so the swap isn't made under a bar half slid away. The
 * `probe` goes anywhere in the screen. Elsewhere, or without the module, the offset stays 0.
 */
export function useNativeBarOffset(): { offset: SharedValue<number>; probe: ReactElement | null } {
  const offset = useSharedValue(0);
  const probe =
    NATIVE_HEADER && NavBarEdge ? (
      <NavBarEdge style={styles.probe} pointerEvents="none" onEdgeChange={(e) => offset.set(e.nativeEvent.offset)} />
    ) : null;
  return { offset, probe };
}

const styles = StyleSheet.create({
  probe: { position: 'absolute', width: 0, height: 0 },
});
