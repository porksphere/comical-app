import { AlphaType, ColorType, Skia, TextAlign } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as THREE from 'three/webgpu';

import { boardColour, cssRgb, type Rgb } from '@/lib/bookshelf';
import type { CoverBinding } from '@/lib/book-cover';
import { TITLE_FONT, titleFontCovers } from '@/lib/title-font';

import type { SpinePicture } from './scene';

export type CoverPicture = { texture: THREE.Texture; aspect: number; board: Rgb };

/** A cover's width as a texture: twice a shelf cover's points, which is all a phone shows of it. */
const COVER_WIDTH = 384;
/** Pixels per point a spine is lettered at. */
const SPINE_SCALE = 3;
const RGBA = { colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul } as const;

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
 * its foot. Set as a paragraph, so a title the heading face has no letters for falls back a glyph
 * at a time to the system's, as a drawn text run would not.
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
      const lettered = (text: string, fontSize: number, fontFamilies: string[] | undefined, run: number) => {
        const paragraph = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center, maxLines: 1, ellipsis: '…' })
          .pushStyle({ color: colour, fontSize, ...(fontFamilies ? { fontFamilies } : {}) })
          .addText(text)
          .build();
        paragraph.layout(run);
        return paragraph;
      };
      const run = h * 0.76;
      const name = lettered(title, Math.min(w * 0.5, 15 * SPINE_SCALE), titleFontCovers(title) ? [TITLE_FONT] : undefined, run);
      canvas.save();
      // Turned a quarter clockwise the paragraph runs down the spine and its lines stack leftward.
      canvas.translate(w / 2 + name.getHeight() / 2, h * 0.08);
      canvas.rotate(90, 0, 0);
      name.paint(canvas, 0, 0);
      canvas.restore();
      if (number) lettered(number, Math.min(w * 0.42, 12 * SPINE_SCALE), undefined, w).paint(canvas, 0, h * 0.875);
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
