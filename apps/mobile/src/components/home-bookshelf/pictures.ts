import * as THREE from 'three/webgpu';

import type { CoverBinding } from '@/lib/book-cover';

import { coverPixels, spinePixels, type Pixels } from './pixels';
import type { ShelfCover, SpinePicture } from './spec';

export { prepare } from './pixels';

function textureOf({ pixels, width, height }: Pixels): THREE.Texture {
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The rows are from the top; a data texture's first row is its bottom.
  texture.flipY = true;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A cover as three's texture and the cloth its book is bound in (`coverPixels`). */
export async function loadCover(uri: string, binding: CoverBinding): Promise<ShelfCover | null> {
  const cover = await coverPixels(uri, binding);
  return cover && { picture: textureOf(cover), aspect: cover.aspect, board: cover.board };
}

/** A spine's lettering as three's texture (`spinePixels`). */
export function drawSpine(spine: SpinePicture): THREE.Texture | null {
  const lettering = spinePixels(spine);
  return lettering && textureOf(lettering);
}
