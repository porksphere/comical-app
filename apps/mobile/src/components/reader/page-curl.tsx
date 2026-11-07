import { Canvas, Fill, Group, ImageShader, Shader, Skia, type SkImage } from '@shopify/react-native-skia';
import { PixelRatio, StyleSheet } from 'react-native';
import { runOnJS, useAnimatedReaction, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { FLAT, type CurlFrame, type Leaf } from '@/components/reader/page-curl-geometry';
import { CURL_SKSL, curlUniforms } from '@/components/reader/page-curl-shader';

const EFFECT = Skia.RuntimeEffect.Make(CURL_SKSL);
// Stands in for a picture not yet taken: the effect takes two, and a shader short of a child is no
// shader, a black fill.
const BLANK = Skia.Surface.Make(1, 1)?.makeImageSnapshot() ?? null;

/** A picture of a pager cell, by the cell's key, as handed to the curl on the UI thread. */
export type StagedPicture = { key: string; image: SkImage };

/**
 * A turn that has landed, held on the UI thread with everything the curl needs to go on drawing
 * it: the spread it reached, flat, until the pager has drawn that spread under it, whatever turn
 * a next drag arms meanwhile. `id` names the two cells, as `turnId`.
 */
export type LandedTurn = {
  id: string;
  leaf: Leaf;
  mirrored: boolean;
  fromKey: string;
  toKey: string;
  frame: CurlFrame;
  /** Which arming it was (`armSeq` in the hook): a turn armed after it takes over from it. */
  seq: number;
};

/** The turn between two cells, by their keys. */
export function turnId(cells: { fromKey: string; toKey: string }): string {
  'worklet';
  return `${cells.fromKey}>${cells.toKey}`;
}

/**
 * The curl drawn over the pager for the length of a turn, the pager itself standing still under it.
 * Everything it draws from is the UI thread's — the turn armed there (its leaf, which way turn
 * space lies on the screen, the keys of the two cells it runs between), the frame (the finger, or
 * the turn finishing on its own), the pictures of the cells staged by key, and the turn that has
 * landed — so a drag is drawn from its first frame when its pictures are in, with no render
 * between the finger and the screen. Takes no touches.
 *
 * Drawn only while a turn is armed or landed and both of its pictures are staged: a picture not
 * in yet leaves the pager showing, flat, as the slide would.
 */
export function PageCurl({
  pictures,
  armed,
  armedFromKey,
  armedToKey,
  leaf,
  mirrored,
  frame,
  landed,
  width,
  height,
}: {
  pictures: SharedValue<StagedPicture[]>;
  armed: SharedValue<string>;
  armedFromKey: SharedValue<string>;
  armedToKey: SharedValue<string>;
  leaf: SharedValue<Leaf | null>;
  mirrored: SharedValue<boolean>;
  frame: SharedValue<CurlFrame>;
  landed: SharedValue<LandedTurn | null>;
  width: number;
  height: number;
}) {
  const density = PixelRatio.get();
  // The pictures are looked up inline, not through a helper: a derived value follows the shared
  // values captured in it, not those a function it calls captures, and through a helper the curl
  // went on drawing a cell's old picture after it was replaced, then disposed — black, or nothing.
  const from = useDerivedValue(() => {
    const key = landed.value?.fromKey ?? armedFromKey.value;
    for (const p of pictures.value) if (p.key === key) return p.image;
    return null;
  });
  const to = useDerivedValue(() => {
    const key = landed.value?.toKey ?? armedToKey.value;
    for (const p of pictures.value) if (p.key === key) return p.image;
    return null;
  });
  const fromImage = useDerivedValue(() => from.value ?? BLANK);
  const toImage = useDerivedValue(() => to.value ?? BLANK);
  const uniforms = useDerivedValue(() => {
    const l = landed.value;
    const shape = l ? l.leaf : leaf.value;
    const flat = { x: 0, y: 0, width, height };
    return curlUniforms(
      { width, height },
      l ? l.mirrored : mirrored.value,
      shape ?? { box: flat, radii: [0, 0, 0, 0], spine: width, dual: false },
      l ? l.frame : shape ? frame.value : FLAT,
      density,
    );
  });
  const shown = useDerivedValue(() => ((landed.value || armed.value !== '') && from.value && to.value ? 1 : 0));
  // TEMPORARY: what the canvas sees when the curl comes up, to Metro.
  const probe = (report: string) => {
    if (__DEV__) console.log(`[page-curl] canvas: ${report}`);
  };
  useAnimatedReaction(
    () => shown.value,
    (s, prev) => {
      if (s !== 1 || prev === 1) return;
      const describe = (img: SkImage | null) => {
        if (!img) return 'none';
        try {
          const proto = Object.getPrototypeOf(img) === Object.prototype ? 'plain' : 'classed';
          return `${img.width()}x${img.height()} ${proto} shader:${typeof img.makeShaderOptions}`;
        } catch (e) {
          return `threw ${String(e)}`;
        }
      };
      const u = uniforms.value;
      runOnJS(probe)(
        `from ${describe(from.value)}; to ${describe(to.value)}; leaf ${JSON.stringify(u.leaf)} n ${JSON.stringify(u.n)} c ${u.c} r ${u.r} shade ${u.shade}; ` +
          `landed ${landed.value ? 'yes' : 'no'}; armed ${armed.value}; staged ${pictures.value.map((p) => p.key.slice(-8)).join(',')}`,
      );
    },
  );
  if (!EFFECT || !BLANK) return null;
  const rect = { x: 0, y: 0, width, height };
  return (
    <Canvas style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Group opacity={shown}>
        <Fill>
          <Shader source={EFFECT} uniforms={uniforms}>
            <ImageShader image={fromImage} fit="fill" rect={rect} tx="clamp" ty="clamp" />
            <ImageShader image={toImage} fit="fill" rect={rect} tx="clamp" ty="clamp" />
          </Shader>
        </Fill>
      </Group>
    </Canvas>
  );
}
