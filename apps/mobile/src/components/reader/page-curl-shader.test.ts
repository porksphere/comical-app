import { beforeAll, describe, expect, test } from 'bun:test';
import CanvasKitInit, { type CanvasKit, type RuntimeEffect } from 'canvaskit-wasm/bin/full/canvaskit.js';

import {
  curlFrame,
  FLAT,
  halfPageBox,
  landingPoint,
  makeLeaf,
  singlePageBox,
  turnPull,
  type CurlFrame,
  type Leaf,
} from './page-curl-geometry';
import { CURL_SKSL, curlUniformArray, curlUniforms } from './page-curl-shader';

// Skia's own compiler and rasterizer, through CanvasKit: the effect the app runs, drawn on the CPU.

const W = 120;
const H = 80;
let CK: CanvasKit;
let effect: RuntimeEffect;

beforeAll(async () => {
  const dir = require.resolve('canvaskit-wasm/bin/full/canvaskit.js').replace(/canvaskit\.js$/, '');
  CK = await CanvasKitInit({ locateFile: (file: string) => dir + file });
  const errors: string[] = [];
  const made = CK.RuntimeEffect.Make(CURL_SKSL, (e) => errors.push(e));
  if (!made) throw new Error(errors.join('\n'));
  effect = made;
});

type Rgb = [number, number, number];
/** A picture of the screen: `left` on the left half, `right` on the right. */
function picture(left: Rgb, right: Rgb) {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = x < W / 2 ? left : right;
      px.set([...c, 255], (y * W + x) * 4);
    }
  const info = { width: W, height: H, alphaType: CK.AlphaType.Unpremul, colorType: CK.ColorType.RGBA_8888, colorSpace: CK.ColorSpace.SRGB };
  return CK.MakeImage(info, px, W * 4)!;
}

function draw(leaf: Leaf, frame: CurlFrame, mirrored = false, cur = picture([200, 0, 0], [0, 200, 0]), next = picture([0, 0, 200], [200, 200, 0])) {
  const surface = CK.MakeSurface(W, H)!;
  const sampler = (img: ReturnType<typeof picture>) => img.makeShaderOptions(CK.TileMode.Clamp, CK.TileMode.Clamp, CK.FilterMode.Nearest, CK.MipmapMode.None);
  const uniforms = curlUniformArray(curlUniforms({ width: W, height: H }, mirrored, leaf, frame, 1));
  const shader = effect.makeShaderWithChildren(uniforms, [sampler(cur), sampler(next)]);
  const paint = new CK.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawPaint(paint);
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, alphaType: CK.AlphaType.Unpremul, colorType: CK.ColorType.RGBA_8888, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
  return (x: number, y: number): Rgb => {
    const i = (Math.round(y) * W + Math.round(x)) * 4;
    return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
  };
}

const viewport = { width: W, height: H };
const SQUARE_SCREEN = [0, 0, 0, 0] as const;
// Pages that fill their halves exactly, so every point of the screen belongs to a page.
const halfShape = { width: W / 2, height: H };

describe('the curl effect', () => {
  test('compiles with the uniforms the app sets', () => {
    expect(effect.getUniformFloatCount()).toBe(curlUniformArray(curlUniforms(viewport, false, makeLeaf(halfPageBox(halfShape, viewport, 'right'), viewport, SQUARE_SCREEN, true, false), FLAT, 1)).length);
  });

  test('at rest it is the spread being left, exactly', () => {
    const leaf = makeLeaf(halfPageBox(halfShape, viewport, 'right'), viewport, SQUARE_SCREEN, true, false);
    const at = draw(leaf, FLAT);
    expect(at(10, 40)).toEqual([200, 0, 0]);
    expect(at(100, 40)).toEqual([0, 200, 0]);
  });

  test('landed, it is the spread turned to, exactly', () => {
    const leaf = makeLeaf(halfPageBox(halfShape, viewport, 'right'), viewport, SQUARE_SCREEN, true, false);
    const end = landingPoint(leaf, 60);
    const at = draw(leaf, curlFrame(leaf, 60, end.x, end.y));
    expect(at(10, 40)).toEqual([0, 0, 200]);
    expect(at(100, 40)).toEqual([200, 200, 0]);
  });

  test('turning back runs the same turn mirrored', () => {
    const leaf = makeLeaf(halfPageBox(halfShape, viewport, 'left'), viewport, SQUARE_SCREEN, true, true);
    const end = landingPoint(leaf, 60);
    // Back from `next` to `cur`: the picture turned to is the one on the left of the screen.
    const at = draw(leaf, curlFrame(leaf, 60, end.x, end.y), true, picture([1, 2, 3], [4, 5, 6]), picture([9, 9, 9], [7, 7, 7]));
    expect(at(10, 40)).toEqual([9, 9, 9]);
    expect(at(100, 40)).toEqual([7, 7, 7]);
  });

  test('mid-turn shows the leaf, its back and the page beneath', () => {
    const leaf = makeLeaf(halfPageBox(halfShape, viewport, 'right'), viewport, SQUARE_SCREEN, true, false);
    const pull = turnPull(leaf, 60, 0.5);
    const at = draw(leaf, curlFrame(leaf, 60, pull.x, pull.y));
    const seen = new Set<string>();
    for (let x = 1; x < W; x += 2) for (let y = 1; y < H; y += 2) seen.add(at(x, y).join());
    const hue = (c: string) => {
      const [r, g, b] = c.split(',').map(Number) as Rgb;
      return r > g + 40 && r > b + 40 ? 'red' : g > r + 40 ? 'green' : b > r + 40 ? 'blue' : r > 60 && g > 60 && b < 40 ? 'yellow' : 'other';
    };
    const hues = new Set([...seen].map(hue));
    // The left page stays, the leaf's back (the next left page) is over it, the next right page is revealed.
    expect(hues.has('red')).toBe(true);
    expect(hues.has('blue')).toBe(true);
    expect(hues.has('yellow')).toBe(true);
  });

  test('a lone page turns as paper over the page beneath', () => {
    const page = singlePageBox({ width: 60, height: 80 }, viewport, 'auto', false);
    const leaf = makeLeaf(page, viewport, SQUARE_SCREEN, false, false);
    const end = landingPoint(leaf, 60);
    const landed = draw(leaf, curlFrame(leaf, 60, end.x, end.y), false, picture([200, 0, 0], [200, 0, 0]), picture([0, 0, 200], [0, 0, 200]));
    // Turned all the way over, the leaf lies off the page to the left and the next page is uncovered.
    expect(landed(W / 2, 40)).toEqual([0, 0, 200]);
  });
});
