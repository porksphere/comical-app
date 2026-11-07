import { type CoverGlow, glowFromTones, oneOfAFew } from '@/lib/cover-glow';

const RIM = require('@/assets/images/book-glow-rim.png') as { uri: string };
const FOOT = require('@/assets/images/book-glow-foot.png') as { uri: string };

function loaded(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = uri;
  });
}

let shapes: Promise<[HTMLImageElement, HTMLImageElement]> | undefined;

/** The glow drawn once in this cover's tints: each white shape filled with its colour where it has
 *  any, the foot over the rim, as `BookShadow` stacks them on native. */
async function drawGlow({ rim, foot }: CoverGlow): Promise<string> {
  shapes ??= Promise.all([loaded(RIM.uri), loaded(FOOT.uri)]);
  const [rimShape, footShape] = await shapes;
  const out = document.createElement('canvas');
  out.width = rimShape.naturalWidth;
  out.height = rimShape.naturalHeight;
  const scratch = document.createElement('canvas');
  scratch.width = out.width;
  scratch.height = out.height;
  const into = out.getContext('2d');
  const tint = scratch.getContext('2d');
  if (!into || !tint) throw new Error('no 2d canvas');
  for (const [shape, colour] of [[rimShape, rim], [footShape, foot]] as const) {
    tint.globalCompositeOperation = 'source-over';
    tint.clearRect(0, 0, scratch.width, scratch.height);
    tint.drawImage(shape, 0, 0);
    tint.globalCompositeOperation = 'source-in';
    tint.fillStyle = colour;
    tint.fillRect(0, 0, scratch.width, scratch.height);
    into.drawImage(scratch, 0, 0);
  }
  // `toBlob` encodes off the main thread, where `toDataURL` would stall a scroll for each cover. The
  // URL is never revoked: one small picture per cover shown, for the session, is the cache.
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('could not encode the glow');
  return URL.createObjectURL(blob);
}

/**
 * The web's reader: expo-image can't hash a picture here, so the browser scales the cover down to a
 * single column of six pixels and the top and bottom ones are the tones. Reading pixels needs the
 * picture's host to allow it (CORS); where it doesn't, this is `null` and the glow stays neutral.
 */
export async function readCoverGlow(uri: string): Promise<CoverGlow | null> {
  return oneOfAFew(async () => {
    try {
      const response = await fetch(uri);
      if (!response.ok) return null;
      const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: 1, resizeHeight: 6, resizeQuality: 'high' });
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 6;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const px = context.getImageData(0, 0, 1, 6).data;
      const glow = glowFromTones([px[0], px[1], px[2]], [px[20], px[21], px[22]]);
      return { ...glow, picture: await drawGlow(glow) };
    } catch {
      return null;
    }
  });
}
