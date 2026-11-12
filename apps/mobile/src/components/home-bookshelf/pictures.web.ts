import { loadAsync } from 'expo-font';
import * as THREE from 'three/webgpu';

import { boardColour, cssRgb, type Rgb } from '@/lib/bookshelf';
import type { CoverBinding } from '@/lib/book-cover';
import { SPINE_FONT, titleFontCovers } from '@/lib/title-font';

import type { SpinePicture } from './scene';

export type CoverPicture = { texture: THREE.Texture; aspect: number; board: Rgb };

const COVER_WIDTH = 384;
const SPINE_SCALE = 3;
const SYSTEM_FACE = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** What the spines are lettered with, loaded before the first is drawn: a canvas sets text in a
 *  face only once the page has it, and says nothing when it hasn't. */
export function prepare(): Promise<void> {
  return loadAsync({ [SPINE_FONT]: require('@/assets/fonts/DelaGothicOne-Regular.ttf') })
    .then(() => document.fonts.load(`16px "${SPINE_FONT}"`))
    .then(
      () => {},
      () => {},
    );
}

function textureOf(canvas: HTMLCanvasElement): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A cover as a texture and the cloth its book is bound in. Asked for with CORS, since a picture a
 * canvas can't read back can't be a texture either; `null` when the host won't allow it, which
 * leaves the book in plain cloth.
 */
export async function loadCover(uri: string, binding: CoverBinding): Promise<CoverPicture | null> {
  const image = new window.Image();
  image.crossOrigin = 'anonymous';
  image.src = uri;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(COVER_WIDTH, image.naturalWidth);
  canvas.height = Math.round((canvas.width * image.naturalHeight) / image.naturalWidth);
  const into = canvas.getContext('2d', { willReadFrequently: true });
  if (!into || !canvas.width || !canvas.height) return null;
  into.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = into.getImageData(0, 0, canvas.width, canvas.height);
  return { texture: textureOf(canvas), aspect: canvas.width / canvas.height, board: boardColour(data, canvas.width, canvas.height, binding) };
}

/** A spine's lettering: the title down its length, reading from the head, and a volume's number at
 *  its foot. */
export function drawSpine({ title, number, board, ink, width, height }: SpinePicture): THREE.Texture | null {
  const canvas = document.createElement('canvas');
  const w = (canvas.width = Math.max(8, Math.round(width * SPINE_SCALE)));
  const h = (canvas.height = Math.round(height * SPINE_SCALE));
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = cssRgb(board);
  g.fillRect(0, 0, w, h);
  g.fillStyle = cssRgb(ink);
  g.globalAlpha = 0.5;
  g.fillRect(0, h * 0.04, w, 2);
  g.fillRect(0, h * 0.955, w, 2);
  g.globalAlpha = 1;
  // Too thin a spine to letter is left as cloth.
  if (width > 13) {
    g.textAlign = 'center';
    if (number) {
      g.font = `${Math.min(w * 0.4, 12 * SPINE_SCALE)}px "${SPINE_FONT}", ${SYSTEM_FACE}`;
      g.textBaseline = 'alphabetic';
      g.fillText(number, w / 2, h * 0.935);
    }
    g.font = `${Math.min(w * 0.46, 14 * SPINE_SCALE)}px ${titleFontCovers(title) ? `"${SPINE_FONT}", ` : ''}${SYSTEM_FACE}`;
    g.textBaseline = 'middle';
    const run = h * 0.76;
    let shown = title;
    while (shown.length > 1 && g.measureText(shown).width > run) shown = `${shown.slice(0, -2).trimEnd()}…`;
    g.translate(w / 2, h * 0.08 + run / 2);
    g.rotate(Math.PI / 2);
    g.fillText(shown, 0, 0);
  }
  return textureOf(canvas);
}
