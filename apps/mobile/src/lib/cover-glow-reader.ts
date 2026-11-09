import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { type CoverGlow, glowFromTones, oneOfAFew, tonesFromPixels } from '@/lib/cover-glow';

/** The width the cover is shrunk to before its bands are averaged. */
const SAMPLE_WIDTH = 12;
/** A cover drawn before its download reached the disk is looked for again once, this much later. */
const RETRY_MS = 1500;

/**
 * The original expo-image keeps on disk, or a `data:` cover as it is. Never `Image.loadAsync` with a
 * max size: SDWebImage then left that few-pixel copy in its memory cache under the cover's own key,
 * and the cards drew it — the pixelated covers.
 */
async function fileOf(uri: string): Promise<string | null> {
  if (uri.startsWith('data:') || uri.startsWith('file://')) return uri;
  const path = await Image.getCachePathAsync(uri);
  return path ? (path.startsWith('file://') ? path : `file://${path}`) : null;
}

async function read(uri: string): Promise<CoverGlow | null> {
  const file = await fileOf(uri);
  if (!file) return null;
  const small = await ImageManipulator.manipulate(file).resize({ width: SAMPLE_WIDTH }).renderAsync();
  const png = await small.saveAsync({ format: SaveFormat.PNG, base64: true });
  small.release();
  if (!png.base64) return null;
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(png.base64));
  if (!image) return null;
  try {
    const w = image.width();
    const h = image.height();
    const px = image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    const tones = px ? tonesFromPixels(px, w, h) : null;
    return tones && glowFromTones(tones.top, tones.bottom);
  } finally {
    image.dispose();
  }
}

/**
 * A cover's glow tints, read off a copy of the original on disk a few pixels wide: the card's own
 * download, so no second one, shrunk by the platform's decoder off the main thread (Skia's own don't
 * read AVIF). `null` whenever anything fails, which leaves the glow neutral.
 */
export async function readCoverGlow(uri: string): Promise<CoverGlow | null> {
  for (let tries = 2; tries > 0; tries--) {
    const glow = await oneOfAFew(() => read(uri).catch(() => null));
    if (glow || tries === 1) return glow;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  return null;
}
