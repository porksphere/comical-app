import type { PageImageLayout } from '@comical/contract';
import { ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { DrawCopy } from './page-process';

let scratch = 0;

/** Skia's own decoders don't read AVIF, which sources serve: the platform's does, by way of a PNG. */
async function decodeWithPlatform(bytes: Uint8Array): Promise<SkImage | null> {
  const file = new File(Paths.cache, `page-layout-${Date.now()}-${(scratch += 1)}`);
  try {
    file.write(bytes);
    const decoded = await ImageManipulator.manipulate(file.uri).renderAsync();
    const png = await decoded.saveAsync({ format: SaveFormat.PNG, base64: true });
    decoded.release();
    return png.base64 ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(png.base64)) : null;
  } finally {
    if (file.exists) file.delete();
  }
}

/** The page drawn by its layout, as a `data:` URI an `<Image>` can show. */
export async function drawLayout(bytes: Uint8Array, layout: PageImageLayout, copies: readonly DrawCopy[], png: boolean): Promise<string> {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes)) ?? (await decodeWithPlatform(bytes));
  if (!image) throw new Error('could not decode the page image to draw it');
  try {
    const surface = Skia.Surface.Make(layout.width, layout.height);
    if (!surface) throw new Error(`could not make a ${layout.width}×${layout.height} surface to draw the page on`);
    const canvas = surface.getCanvas();
    const paint = Skia.Paint();
    for (const c of copies) {
      canvas.drawImageRect(image, Skia.XYWHRect(c.sx, c.sy, c.sw, c.sh), Skia.XYWHRect(c.dx, c.dy, c.dw, c.dh), paint);
    }
    surface.flush();
    const out = surface.makeImageSnapshot();
    try {
      const b64 = out.encodeToBase64(png ? ImageFormat.PNG : ImageFormat.JPEG, png ? 100 : 92);
      return `data:image/${png ? 'png' : 'jpeg'};base64,${b64}`;
    } finally {
      out.dispose();
    }
  } finally {
    image.dispose();
  }
}
