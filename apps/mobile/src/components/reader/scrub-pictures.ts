import { Skia, type SkImage } from '@shopify/react-native-skia';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { halfLayout } from '@/components/reader/gutter-bands';
import { fileOf, spreadColorsNow } from '@/components/reader/gutter-colors';
import { containedSize, edgeOffset, pageRest, panLimits, type Size } from '@/components/reader/page-geometry';
import { knownPageSize, spreadHalves, type SpreadPad } from '@/components/reader/spreads';
import type { PageFit, SpreadFill } from '@/hooks/use-reader-settings';

/**
 * Pictures of pager cells for a scrub's curl, drawn here from the pages themselves rather than
 * taken of the cells. A cell's picture (`makeImageFromView`) is drawn on the main thread, the curl's
 * own, for 50ms and more, and a scrub reaches a new page every few frames: each picture stopped the
 * turn under the scrubber dead, and it jumped on when the thread came back. These are drawn on the
 * JS thread, from the page as published shrunk by the platform's decoder off the main thread, laid
 * out as the cell lays it out — at rest, the spread's padding and all — at `SCALE` points per pixel
 * of the screen's: softer than the cell, which no turn under a moving scrubber shows.
 */

/** Pixels per point the pictures are drawn at. */
const SCALE = 1.25;
/** Decoded pages kept for reuse, the most recent last: enough for the pairs about a scrub. */
const KEEP = 6;

type Cell = { key: string; pages: { uri: string }[]; pad?: SpreadPad };
type Layout = { width: number; height: number; double: boolean; rtl: boolean; pageFit: PageFit; spreadFill: SpreadFill };
type Box = { x: number; y: number; width: number; height: number };

const decoded = new Map<string, Promise<SkImage | null>>();

async function decode(uri: string, width: number): Promise<SkImage | null> {
  const file = await fileOf(uri);
  if (!file) return null;
  const small = await ImageManipulator.manipulate(file).resize({ width }).renderAsync();
  // JPEG, not PNG: quicker to make, and a page has no transparency to keep.
  const encoded = await small.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
  small.release();
  return encoded.base64 ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(encoded.base64)) : null;
}

/** A page decoded to `width` pixels across, shared between the pictures it is in. */
function page(uri: string, width: number): Promise<SkImage | null> {
  const key = `${width}|${uri}`;
  let made = decoded.get(key);
  if (made) {
    decoded.delete(key);
  } else {
    made = decode(uri, width).catch(() => null);
    while (decoded.size >= KEEP) {
      const [oldest, gone] = decoded.entries().next().value!;
      decoded.delete(oldest);
      void gone.then((image) => image?.dispose());
    }
  }
  decoded.set(key, made);
  return made;
}

/** Where a page of `size` lies in the cell's box `frame`, contained and against `hug`. */
function hugged(size: Size, frame: Box, hug: 'left' | 'right' | null): Box {
  const shown = containedSize(size, frame);
  const x = hug === 'left' ? frame.x : hug === 'right' ? frame.x + frame.width - shown.width : frame.x + (frame.width - shown.width) / 2;
  return { x, y: frame.y + (frame.height - shown.height) / 2, width: shown.width, height: shown.height };
}

/**
 * A picture of `cell` as the pager draws it at rest, or null where a page's size isn't known yet
 * or it can't be read.
 */
export async function scrubPicture(cell: Cell, layout: Layout): Promise<SkImage | null> {
  const { width, height, rtl, pageFit, spreadFill } = layout;
  const viewport = { width, height };
  const halves = spreadHalves(cell);
  // What goes where: each page's box on the screen, and a fill beside it.
  const draws: { uri: string; box: Box }[] = [];
  const fills: { box: Box; color: string }[] = [];
  if (halves.length > 1) {
    const half = width / 2;
    const onScreen = rtl ? [...halves].reverse() : halves;
    const sides = onScreen.map((p, i) => {
      const spine = i === 0 ? 'right' : 'left';
      return { p, spine, ...halfLayout(spine, spreadFill) } as const;
    });
    const colors = spreadColorsNow(
      sides[0]!.p && sides[0]!.filled ? { uri: sides[0]!.p.uri, side: sides[0]!.filled } : undefined,
      sides[1]!.p && sides[1]!.filled ? { uri: sides[1]!.p.uri, side: sides[1]!.filled } : undefined,
      spreadFill === 'middle',
    );
    for (let i = 0; i < 2; i++) {
      const { p, hug, filled } = sides[i]!;
      if (!p) continue;
      const size = knownPageSize(p.uri);
      if (!size) return null;
      const frame = { x: i * half, y: 0, width: half, height };
      const box = hugged(size, frame, hug);
      draws.push({ uri: p.uri, box });
      const color = colors[i];
      if (filled && color) {
        // A point under the page, as the cell's fill runs (`SpreadGutter`).
        const gap =
          filled === 'left'
            ? { x: frame.x, width: box.x - frame.x + 1 }
            : { x: box.x + box.width - 1, width: frame.x + half - (box.x + box.width) + 1 };
        if (gap.width > 1.5) fills.push({ box: { ...gap, y: box.y, height: box.height }, color });
      }
    }
  } else {
    const p = cell.pages[0]!;
    const size = knownPageSize(p.uri);
    if (!size) return null;
    // At its rest, as the pager draws it: contained, then scaled and set at its edge where it rests
    // zoomed (a wide page fitted to the height).
    const rest = pageRest(size, viewport, pageFit, false, rtl, false);
    const off = edgeOffset(rest.restEdge, panLimits(rest.restScale, rest.content, viewport));
    const w = rest.content.width * rest.restScale;
    const h = rest.content.height * rest.restScale;
    draws.push({ uri: p.uri, box: { x: (width - w) / 2 + off.x, y: (height - h) / 2 + off.y, width: w, height: h } });
  }

  const images = await Promise.all(draws.map((d) => page(d.uri, Math.ceil(d.box.width * SCALE))));
  if (images.some((image) => !image)) return null;
  const surface = Skia.Surface.Make(Math.round(width * SCALE), Math.round(height * SCALE));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  // In whole pixels: drawn at fractional ones, two pages meeting at a spine that falls between
  // pixels each left the pixel half bare, a hairline down the middle of the spread.
  const px = (box: Box) => {
    const left = Math.round(box.x * SCALE);
    const top = Math.round(box.y * SCALE);
    return Skia.XYWHRect(left, top, Math.round((box.x + box.width) * SCALE) - left, Math.round((box.y + box.height) * SCALE) - top);
  };
  const paint = Skia.Paint();
  for (const fill of fills) {
    const color = Skia.Paint();
    color.setColor(Skia.Color(fill.color));
    canvas.drawRect(px(fill.box), color);
  }
  draws.forEach((d, i) => {
    const image = images[i]!;
    canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), px(d.box), paint);
  });
  const picture = surface.makeImageSnapshot();
  surface.dispose();
  return picture;
}
