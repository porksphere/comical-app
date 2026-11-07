import { Canvas, Fill, Group, ImageShader, Shader, Skia, type SkImage } from '@shopify/react-native-skia';
import { PixelRatio, StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { CurlFrame, Leaf } from '@/components/reader/page-curl-geometry';
import { CURL_SKSL, curlUniforms } from '@/components/reader/page-curl-shader';

const EFFECT = Skia.RuntimeEffect.Make(CURL_SKSL);

/**
 * One page turn in flight: the leaf (turn space, see `page-curl-geometry`), which way turn space
 * lies on the screen, and pictures of the two spreads the turn runs between, taken off the pager's
 * own cells so the curl turns exactly what was on screen. `id` names the two cells, as `turnId`.
 */
export type CurlTurn = { id: string; leaf: Leaf; mirrored: boolean; from: SkImage; to: SkImage };

/** The turn between two cells, by their keys. */
export function turnId(cells: { fromKey: string; toKey: string }): string {
  'worklet';
  return `${cells.fromKey}>${cells.toKey}`;
}

/**
 * The curl drawn over the pager for the length of a turn, the pager itself standing still under it.
 * The frame comes from the UI thread — the finger, or the turn finishing on its own — and reaches
 * the effect's uniforms without a render. Takes no touches.
 *
 * Drawn only while `armed` is this turn. A drag can arm the next turn on the UI thread in the frames
 * the last one stands over the pager after landing, and those pictures under the new turn's frame
 * would flash the page it came from; the pager under it already shows where the turn landed.
 */
export function PageCurl({
  turn,
  armed,
  frame,
  width,
  height,
}: {
  turn: CurlTurn;
  armed: SharedValue<string>;
  frame: SharedValue<CurlFrame>;
  width: number;
  height: number;
}) {
  const { id, leaf, mirrored, from, to } = turn;
  const density = PixelRatio.get();
  const uniforms = useDerivedValue(() => curlUniforms({ width, height }, mirrored, leaf, frame.value, density));
  const shown = useDerivedValue(() => (armed.value === id ? 1 : 0));
  if (!EFFECT) return null;
  const rect = { x: 0, y: 0, width, height };
  return (
    <Canvas style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Group opacity={shown}>
        <Fill>
          <Shader source={EFFECT} uniforms={uniforms}>
            <ImageShader image={from} fit="fill" rect={rect} tx="clamp" ty="clamp" />
            <ImageShader image={to} fit="fill" rect={rect} tx="clamp" ty="clamp" />
          </Shader>
        </Fill>
      </Group>
    </Canvas>
  );
}
