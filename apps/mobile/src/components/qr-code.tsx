import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { qrPath } from '@/lib/qr-path';

/** Quiet zone, in modules: the spec's minimum, which every phone camera reads. */
const QUIET = 4;

/** A QR code of `value`, drawn `size` points square, dark on white whatever the theme — a scanner
 *  wants the contrast, and an inverted code is not one every reader accepts. */
export function QrCode({ value, size, testID }: { value: string; size: number; testID?: string }) {
  const { size: modules, d } = qrPath(value);
  const span = modules + QUIET * 2;
  return (
    <View testID={testID} accessibilityLabel={`QR code for ${value}`} style={[styles.box, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`}>
        <Path d={d} fill="#000" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
  },
});
