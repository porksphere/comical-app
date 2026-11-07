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

  test("a rounded corner shows the page it belongs to, never the next one, until it turns", () => {
    // A lone page filling a screen rounded at the far corners: the corner outside the curve is still
    // the page on screen while the leaf lies flat, and while it lies flat partway through a turn.
    const leaf = makeLeaf({ x: 0, y: 0, width: W, height: H }, viewport, [0, 30, 30, 0], false, false);
    const atRest = draw(leaf, FLAT);
    expect(atRest(W - 1, 1)).toEqual([0, 200, 0]);
    // The low corner lifted diagonally: the top corner hasn't turned yet.
    const start = turnPull(leaf, H - 1, 0);
    const early = draw(leaf, curlFrame(leaf, H - 1, start.x - 20, start.y - 20));
    expect(early(W - 1, 1)).toEqual([0, 200, 0]);
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

  test('the shadow falls from the crease, under the paper, and only where the crease crosses the page', () => {
    // A page with room above and below it, turning straight across.
    const leaf = makeLeaf({ x: 20, y: 20, width: 80, height: 40 }, viewport, SQUARE_SCREEN, false, false);
    const pull = turnPull(leaf, 50, 0.4);
    const f = curlFrame(leaf, 50, pull.x, pull.y);
    const at = draw(leaf, f, false, picture([200, 0, 0], [200, 0, 0]), picture([0, 0, 200], [0, 0, 200]));
    const past = (d: number, y: number) => [(f.c + d - y * f.ny) / f.nx, y] as const;
    // Beside the roll, above the page: no paper there, so nothing casts a shadow.
    expect(at(...past(f.r / 2, 4))).toEqual([0, 0, 200]);
    // On the page uncovered past the roll, darkest nearest the crease.
    const near = at(...past(f.r + 3, 40));
    const far = at(...past(f.r + 25, 40));
    expect(near[2]).toBeLessThan(far[2]);
    expect(far[2]).toBeLessThan(200);
  });

  test('the turning paper is outlined in ink', () => {
    const leaf = makeLeaf({ x: 0, y: 0, width: W, height: H }, viewport, SQUARE_SCREEN, false, false);
    const pull = turnPull(leaf, 60, 0.3);
    const f = curlFrame(leaf, 60, pull.x, pull.y);
    const light = picture([220, 220, 220], [220, 220, 220]);
    const at = draw(leaf, f, false, light, light);
    // The leaf's free edge, turned over onto the flap: the paper point q lies at p + n(πr − 2d).
    const q = { x: W, y: 30 };
    const d = Math.PI * f.r - (q.x * f.nx + q.y * f.ny - f.c);
    const back = Math.PI * f.r - 2 * d;
    const edge = { x: q.x - f.nx * back, y: q.y - f.ny * back };
    const sum = ([r, g, b]: Rgb) => r + g + b;
    const onEdge = sum(at(edge.x, edge.y));
    // Darker than the flap on one side of it and the page it lies over on the other.
    expect(onEdge).toBeLessThan(sum(at(edge.x + f.nx * 4, edge.y + f.ny * 4)));
    expect(onEdge).toBeLessThan(sum(at(edge.x - f.nx * 4, edge.y - f.ny * 4)));
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
