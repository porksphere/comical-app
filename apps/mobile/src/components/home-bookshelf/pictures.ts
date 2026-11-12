import { AlphaType, ColorType, Skia, TextAlign, loadData, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as THREE from 'three/webgpu';

import { boardColour, cssRgb, type Rgb } from '@/lib/bookshelf';
import type { CoverBinding } from '@/lib/book-cover';
import { SPINE_FONT, titleFontCovers } from '@/lib/title-font';

import type { SpinePicture } from './scene';

export type CoverPicture = { texture: THREE.Texture; aspect: number; board: Rgb };

/** A cover's width as a texture: twice a shelf cover's points, which is all a phone shows of it. */
const COVER_WIDTH = 384;
/** Pixels per point a spine is lettered at. */
const SPINE_SCALE = 3;
const RGBA = { colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul } as const;

let spineFace: SkTypefaceFontProvider | null = null;
let preparing: Promise<void> | undefined;

/**
 * What the spines are lettered with, loaded once before the first is drawn: their own face
 * (`SPINE_FONT`), from its file. A face asked for by name is not found — a paragraph looks a family
 * up in the system's fonts, where an app's bundled face is filed under a name of its own on iOS and
 * not at all on Android — and every spine was set in the system's face.
 */
export function prepare(): Promise<void> {
  preparing ??= loadData(require('@/assets/fonts/ShipporiMinchoB1-Bold.ttf'), (data) => Skia.Typeface.MakeFreeTypeFaceFromData(data))
    .then((typeface) => {
      if (!typeface) return;
      const provider = Skia.TypefaceFontProvider.Make();
      provider.registerFont(typeface, SPINE_FONT);
      spineFace = provider;
    })
    .catch(() => {});
  return preparing;
}

function textureOf(pixels: Uint8Array, width: number, height: number): THREE.Texture {
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Skia reads rows from the top; a data texture's first row is its bottom.
  texture.flipY = true;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** The original expo-image keeps on disk — fetched to it first when no card has drawn this cover —
 *  or a `data:` cover as it is. Never `Image.loadAsync` with a size: see `cover-glow-reader`. */
async function fileOf(uri: string): Promise<string | null> {
  if (uri.startsWith('data:') || uri.startsWith('file://')) return uri;
  const cached = async () => {
    const path = await Image.getCachePathAsync(uri);
    return path ? (path.startsWith('file://') ? path : `file://${path}`) : null;
  };
  return (await cached()) ?? ((await Image.prefetch(uri, 'disk').catch(() => false)) ? cached() : null);
}

/**
 * A cover as a texture and the cloth its book is bound in. Shrunk by the platform's decoder off the
 * main thread (Skia's own don't read AVIF) and read back through Skia, the way the cover glow reads
 * its tints; `null` when the picture can't be had, which leaves the book in plain cloth.
 */
export async function loadCover(uri: string, binding: CoverBinding): Promise<CoverPicture | null> {
  const file = await fileOf(uri);
  if (!file) return null;
  const small = await ImageManipulator.manipulate(file).resize({ width: COVER_WIDTH }).renderAsync();
  const encoded = await small.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
  small.release();
  const image = encoded.base64 ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(encoded.base64)) : null;
  if (!image) return null;
  try {
    const width = image.width();
    const height = image.height();
    const pixels = image.readPixels(0, 0, { width, height, ...RGBA });
    if (!(pixels instanceof Uint8Array)) return null;
    return { texture: textureOf(pixels, width, height), aspect: width / height, board: boardColour(pixels, width, height, binding) };
  } finally {
    image.dispose();
  }
}

/**
 * A spine's lettering: the title down its length, reading from the head, and a volume's number at
 * its foot. A title the spines' face can set whole is set in it (`prepare`); any other is a
 * paragraph in the system's fonts, which fall back a glyph at a time as a drawn text run would not.
 */
export function drawSpine({ title, number, board, ink, width, height }: SpinePicture): THREE.Texture | null {
  const w = Math.max(8, Math.round(width * SPINE_SCALE));
  const h = Math.round(height * SPINE_SCALE);
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    canvas.drawColor(Skia.Color(cssRgb(board)));
    const colour = Skia.Color(cssRgb(ink));
    const rule = Skia.Paint();
    rule.setColor(colour);
    rule.setAlphaf(0.5);
    canvas.drawRect(Skia.XYWHRect(0, h * 0.04, w, 2), rule);
    canvas.drawRect(Skia.XYWHRect(0, h * 0.955, w, 2), rule);
    // Too thin a spine to letter is left as cloth.
    if (width > 13) {
      const lettered = (text: string, fontSize: number, run: number) => {
        const face = titleFontCovers(text) ? spineFace : null;
        const layout = { textAlign: TextAlign.Center, maxLines: 1, ellipsis: '…' };
        const paragraph = (face ? Skia.ParagraphBuilder.Make(layout, face) : Skia.ParagraphBuilder.Make(layout))
          .pushStyle({ color: colour, fontSize, ...(face ? { fontFamilies: [SPINE_FONT] } : {}) })
          .addText(text)
          .build();
        paragraph.layout(run);
        return paragraph;
      };
      const run = h * 0.76;
      const name = lettered(title, Math.min(w * 0.52, 15 * SPINE_SCALE), run);
      canvas.save();
      // Turned a quarter clockwise the paragraph runs down the spine and its lines stack leftward.
      canvas.translate(w / 2 + name.getHeight() / 2, h * 0.08);
      canvas.rotate(90, 0, 0);
      name.paint(canvas, 0, 0);
      canvas.restore();
      if (number) lettered(number, Math.min(w * 0.44, 12 * SPINE_SCALE), w).paint(canvas, 0, h * 0.875);
    }
    surface.flush();
    const picture = surface.makeImageSnapshot();
    try {
      const pixels = picture.readPixels(0, 0, { width: w, height: h, ...RGBA });
      return pixels instanceof Uint8Array ? textureOf(pixels, w, h) : null;
    } finally {
      picture.dispose();
    }
  } finally {
    surface.dispose();
  }
}
