import type { CoverBinding } from '@/lib/book-cover';

import { coverPixels } from '../pixels';
import type { ShelfCover } from '../spec';
import { PixelPicture } from './scene';

export { prepare } from '../pixels';

/** A cover as its pixels, which the scene makes a texture of once it has a device to make it on,
 *  and the cloth its book is bound in. */
export async function loadCover(uri: string, binding: CoverBinding): Promise<ShelfCover | null> {
  const cover = await coverPixels(uri, binding);
  return cover && { picture: new PixelPicture(cover), aspect: cover.aspect, board: cover.board };
}
