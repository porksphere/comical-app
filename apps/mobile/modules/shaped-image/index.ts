/**
 * `shaped-image` — bakes a corner radius into a PNG, for the pictures UIKit draws as plain
 * UIImages (a navigation bar item's image, a menu row's): nothing above the bitmap can round
 * those, so the file itself carries the shape. See `lib/menu-thumb-files.ts`.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed): the
 * caller shows the square tile instead.
 */
import { requireOptionalNativeModule } from 'expo';

type ShapedImage = {
  /** Writes a copy of the PNG at `uri` clipped to `radius` points (as drawn at `scale`; half the
   *  side is a circle) and resolves to the copy's `file://` URI. */
  clip(uri: string, radius: number, scale: number): Promise<string>;
};

export default requireOptionalNativeModule<ShapedImage>('ShapedImage');
