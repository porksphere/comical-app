import { matchFont, Skia, type SkCanvas, type SkFont, type SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { halfLayout } from '@/components/reader/gutter-bands';
import { fileOf, spreadColorsNow } from '@/components/reader/gutter-colors';
import { containedSize, edgeOffset, pageRest, panLimits, type Size } from '@/components/reader/page-geometry';
import { PAGED_BACKDROP, PLACEHOLDER_STATUS_HEIGHT } from '@/components/reader/reader-page';
import { knownPageSize, spreadHalves, type SpreadPad } from '@/components/reader/spreads';
import { Spacing } from '@/constants/theme';
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

type Cell = { key: string; pages: { uri: string; page: number }[]; pad?: SpreadPad };
type Layout = { width: number; height: number; double: boolean; rtl: boolean; pageFit: PageFit; spreadFill: SpreadFill };
type Box = { x: number; y: number; width: number; height: number };

const decoded = new Map<string, Promise<SkImage | null>>();

/** Fetch a page to the disk cache the scrub draws from, without drawing it: the pager stands still
 *  under a scrub, so nothing else fetches the pages it turns through. Resolves whether it arrived. */
export function fetchPage(uri: string): Promise<boolean> {
  if (uri.startsWith('file://')) return Promise.resolve(true);
  return Image.prefetch(uri, 'disk').catch(() => false);
}

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
    // Not kept when it came to nothing (no file yet): asked again once the page has been fetched.
    made = decode(uri, width)
      .catch(() => null)
      .then((image) => {
        if (!image && decoded.get(key) === made) decoded.delete(key);
        return image;
      });
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

// ReaderPage's placeholder line, as `ScrubBackdrop` matches it: the default type, at half white.
const PLACEHOLDER_TYPE = 16;
let placeholderFont: SkFont | null = null;
function fontAt(scale: number): SkFont {
  placeholderFont ??= matchFont({
    fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
    fontSize: PLACEHOLDER_TYPE,
    fontWeight: '500',
  });
  placeholderFont.setSize(PLACEHOLDER_TYPE * scale);
  return placeholderFont;
}

/** A box in whole pixels at `scale`: drawn at fractional ones, two pages meeting at a spine that
 *  falls between pixels each left the pixel half bare, a hairline down the middle of the spread. */
function pixels(scale: number) {
  return (box: Box) => {
    const left = Math.round(box.x * scale);
    const top = Math.round(box.y * scale);
    return Skia.XYWHRect(left, top, Math.round((box.x + box.width) * scale) - left, Math.round((box.y + box.height) * scale) - top);
  };
}

/** A page still loading, as the pager draws it in `frame`: its dark surface and "Page N" over the
 *  middle, set up by the status line under it, as ReaderPage stacks the two. */
function drawPlaceholder(canvas: SkCanvas, frame: Box, page: number, scale: number) {
  const surface = Skia.Paint();
  surface.setColor(Skia.Color(PAGED_BACKDROP));
  canvas.drawRect(pixels(scale)(frame), surface);
  const font = fontAt(scale);
  const label = `Page ${page}`;
  const ink = Skia.Paint();
  ink.setColor(Skia.Color('rgba(255,255,255,0.5)'));
  const lineMiddle = frame.y + frame.height / 2 - (Spacing.one + PLACEHOLDER_STATUS_HEIGHT) / 2;
  const { ascent, descent } = font.getMetrics();
  const across = font.measureText(label).width;
  const x = (frame.x + frame.width / 2) * scale - across / 2;
  canvas.drawText(label, x, lineMiddle * scale - (ascent + descent) / 2, ink, font);
}

/**
 * The sheet a scrub's turn draws for a page whose picture isn't in yet: the colour an unloaded page
 * shows, one pixel stretched over the screen, made once and shared by every such turn. The dark
 * paper's light outline and grey screentone are what show the turn (`page-curl-shader.ts`).
 */
export function blankPicture(): SkImage | null {
  const surface = Skia.Surface.Make(1, 1);
  if (!surface) return null;
  surface.getCanvas().clear(Skia.Color(PAGED_BACKDROP));
  const picture = surface.makeImageSnapshot();
  surface.dispose();
  return picture;
}

/**
 * A picture of `cell` as the pager draws it at rest, or null where it can't be drawn at all. A
 * page with nothing on disk to draw yet is drawn as its placeholder, as the pager shows it, and the
 * picture is not `complete`: drawn again once the page has been fetched.
 */
export async function scrubPicture(cell: Cell, layout: Layout): Promise<{ image: SkImage; complete: boolean } | null> {
  const { width, height, rtl, pageFit, spreadFill } = layout;
  const viewport = { width, height };
  const halves = spreadHalves(cell);
  // Each page: its frame on the screen, where a page of a given shape lies in it, and the side its
  // fill runs on, if any.
  type Slot = { uri: string; page: number; frame: Box; place: (size: Size) => Box; filled?: 'left' | 'right'; color?: string };
  const slots: Slot[] = [];
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
      const frame = { x: i * half, y: 0, width: half, height };
      slots.push({
        uri: p.uri,
        page: p.page,
        frame,
        place: (size) => hugged(size, frame, hug),
        ...(filled && colors[i] ? { filled, color: colors[i]! } : {}),
      });
    }
  } else {
    const p = cell.pages[0]!;
    slots.push({
      uri: p.uri,
      page: p.page,
      frame: { x: 0, y: 0, width, height },
      // At its rest, as the pager draws it: contained, then scaled and set at its edge where it
      // rests zoomed (a wide page fitted to the height).
      place: (size) => {
        const rest = pageRest(size, viewport, pageFit, false, rtl, false);
        const off = edgeOffset(rest.restEdge, panLimits(rest.restScale, rest.content, viewport));
        const w = rest.content.width * rest.restScale;
        const h = rest.content.height * rest.restScale;
        return { x: (width - w) / 2 + off.x, y: (height - h) / 2 + off.y, width: w, height: h };
      },
    });
  }

  // Each page decoded at the width it is drawn — a page the pager hasn't sized yet (the scrub fetches
  // its pages itself, and the pager stands still under it) takes its shape from the copy decoded
  // at its frame's width. A page with nothing on disk to draw stands as its placeholder.
  const drawn = await Promise.all(
    slots.map(async (slot) => {
      const known = knownPageSize(slot.uri);
      if (known) {
        const box = slot.place(known);
        const image = await page(slot.uri, Math.ceil(box.width * SCALE));
        return image ? { slot, box, image } : null;
      }
      let image = await page(slot.uri, Math.ceil(slot.frame.width * SCALE));
      if (!image) return null;
      const box = slot.place({ width: image.width(), height: image.height() });
      // Drawn far wider than decoded (a wide page resting zoomed): decoded again at that width.
      if (box.width * SCALE > image.width() * 1.2) image = (await page(slot.uri, Math.ceil(box.width * SCALE))) ?? image;
      return { slot, box, image };
    }),
  );

  const surface = Skia.Surface.Make(Math.round(width * SCALE), Math.round(height * SCALE));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const px = pixels(SCALE);
  const paint = Skia.Paint();
  let complete = true;
  drawn.forEach((d, i) => {
    if (!d) {
      complete = false;
      drawPlaceholder(canvas, slots[i]!.frame, slots[i]!.page, SCALE);
      return;
    }
    const { slot, box, image } = d;
    if (slot.filled && slot.color) {
      // A point under the page, as the cell's fill runs (`SpreadGutter`).
      const { frame } = slot;
      const gap =
        slot.filled === 'left'
          ? { x: frame.x, width: box.x - frame.x + 1 }
          : { x: box.x + box.width - 1, width: frame.x + frame.width - (box.x + box.width) + 1 };
      if (gap.width > 1.5) {
        const color = Skia.Paint();
        color.setColor(Skia.Color(slot.color));
        canvas.drawRect(px({ ...gap, y: box.y, height: box.height }), color);
      }
    }
    canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), px(box), paint);
  });
  const picture = surface.makeImageSnapshot();
  surface.dispose();
  return { image: picture, complete };
}
