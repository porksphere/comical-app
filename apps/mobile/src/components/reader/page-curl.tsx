import { Canvas, Fill, ImageShader, Shader, Skia, type SkImage } from '@shopify/react-native-skia';
import { PixelRatio, StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { CurlFrame, Leaf } from '@/components/reader/page-curl-geometry';
import { CURL_SKSL, curlUniforms } from '@/components/reader/page-curl-shader';

const EFFECT = Skia.RuntimeEffect.Make(CURL_SKSL);

/**
 * One page turn in flight: the leaf (turn space, see `page-curl-geometry`), which way turn space
 * lies on the screen, and pictures of the two spreads the turn runs between, taken off the pager's
 * own cells so the curl turns exactly what was on screen.
 */
export type CurlTurn = { leaf: Leaf; mirrored: boolean; from: SkImage; to: SkImage };

/**
 * The curl drawn over the pager for the length of a turn, the pager itself standing still under it.
 * The frame comes from the UI thread — the finger, or the turn finishing on its own — and reaches
 * the effect's uniforms without a render. Takes no touches.
 */
export function PageCurl({
  turn,
  frame,
  width,
  height,
}: {
  turn: CurlTurn;
  frame: SharedValue<CurlFrame>;
  width: number;
  height: number;
}) {
  const { leaf, mirrored, from, to } = turn;
  const density = PixelRatio.get();
  const uniforms = useDerivedValue(() => curlUniforms({ width, height }, mirrored, leaf, frame.value, density));
  if (!EFFECT) return null;
  const rect = { x: 0, y: 0, width, height };
  return (
    <Canvas style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Fill>
        <Shader source={EFFECT} uniforms={uniforms}>
          <ImageShader image={from} fit="fill" rect={rect} tx="clamp" ty="clamp" />
          <ImageShader image={to} fit="fill" rect={rect} tx="clamp" ty="clamp" />
        </Shader>
      </Fill>
    </Canvas>
  );
}
