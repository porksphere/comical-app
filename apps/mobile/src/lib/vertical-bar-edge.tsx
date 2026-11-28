import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { StyleSheet } from 'react-native';

import { VerticalBarEdgeProbe, type VerticalBarEdge } from '../../modules/vertical-bar-edge';

const edge$ = observable<VerticalBarEdge | undefined>(undefined);

/**
 * Whether iOS stands the bars beside the content as a column here, as UIKit says it
 * (`verticalBarEdge`). Undefined until a probe has reported: before iOS 27.1, off iOS, and for the
 * first frames of a launch.
 */
export function useBarsVertical(): boolean | undefined {
  const edge = use$(edge$);
  return edge === undefined ? undefined : edge !== 'unspecified';
}

/** The probe, in a screen whose bar the answer is for. */
export function VerticalBarEdgeReporter() {
  if (!VerticalBarEdgeProbe) return null;
  return <VerticalBarEdgeProbe style={styles.pin} pointerEvents="none" onEdge={(e) => edge$.set(e.nativeEvent.edge)} />;
}

const styles = StyleSheet.create({
  pin: { position: 'absolute', width: 0, height: 0 },
});
