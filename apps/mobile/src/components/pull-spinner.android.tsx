import { ContainedLoadingIndicator, useNativeState } from '@expo/ui/jetpack-compose';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';

import { MaterialHost } from '@/components/material-host';

// Material's contained loading indicator: a 48dp container.
const SIZE = 48;

/**
 * Android's pull-to-refresh spinner: Material's loading indicator, its shape following the pull
 * and running free while the refresh does. The Compose host is mounted only for a pull or a
 * refresh, so a list at rest carries an empty box.
 */
export function PullSpinner({
  pullY,
  pullThreshold,
  refreshing,
}: {
  pullY: SharedValue<number>;
  pullThreshold: number;
  refreshing: boolean;
  color: string;
  size?: number;
}) {
  const [pulling, setPulling] = useState(false);
  useAnimatedReaction(
    () => pullY.value > 0,
    (now, was) => {
      if (now !== was) runOnJS(setPulling)(now);
    },
  );
  return (
    <View style={styles.box}>
      {refreshing ? (
        <MaterialHost style={StyleSheet.absoluteFill}>
          <ContainedLoadingIndicator />
        </MaterialHost>
      ) : pulling ? (
        <Pulled pullY={pullY} pullThreshold={pullThreshold} />
      ) : null}
    </View>
  );
}

function Pulled({ pullY, pullThreshold }: { pullY: SharedValue<number>; pullThreshold: number }) {
  // Written on the UI thread, where the pull is: Compose reads it without a render.
  const progress = useNativeState<number | null>(0);
  useAnimatedReaction(
    () => Math.min(1, Math.max(0, pullY.value / pullThreshold)),
    (now) => {
      progress.set(now);
    },
  );
  return (
    <MaterialHost style={StyleSheet.absoluteFill}>
      <ContainedLoadingIndicator progress={progress} />
    </MaterialHost>
  );
}

const styles = StyleSheet.create({
  box: {
    width: SIZE,
    height: SIZE,
  },
});
