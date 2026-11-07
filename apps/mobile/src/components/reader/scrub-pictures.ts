import { matchFont, Skia, type SkCanvas, type SkFont, type SkImage } from '@shopify/react-native-skia';
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

/** A page still loading, as the pager draws it in `frame`: its dark surface and "Page N" over the
 *  middle, set up by the status line under it, as ReaderPage stacks the two. */
function drawPlaceholder(canvas: SkCanvas, frame: Box, page: number, rect: (box: Box) => ReturnType<typeof Skia.XYWHRect>) {
  const surface = Skia.Paint();
  surface.setColor(Skia.Color(PAGED_BACKDROP));
  canvas.drawRect(rect(frame), surface);
  const font = fontAt(SCALE);
  const label = `Page ${page}`;
  const ink = Skia.Paint();
  ink.setColor(Skia.Color('rgba(255,255,255,0.5)'));
  const lineMiddle = frame.y + frame.height / 2 - (Spacing.one + PLACEHOLDER_STATUS_HEIGHT) / 2;
  const { ascent, descent } = font.getMetrics();
  const across = font.measureText(label).width;
  const x = (frame.x + frame.width / 2) * SCALE - across / 2;
  canvas.drawText(label, x, lineMiddle * SCALE - (ascent + descent) / 2, ink, font);
}

/**
 * A picture of `cell` as the pager draws it at rest, or null where it can't be drawn at all. A
 * page not yet in — no size, or nothing on disk to draw — is drawn as its placeholder, as the pager
 * shows it, and the picture is not `complete`: a scrub across pages still loading turns them too,
 * rather than standing still over them.
 */
export async function scrubPicture(cell: Cell, layout: Layout): Promise<{ image: SkImage; complete: boolean } | null> {
  const { width, height, rtl, pageFit, spreadFill } = layout;
  const viewport = { width, height };
  const halves = spreadHalves(cell);
  // What goes where: each page's box on the screen, and a fill beside it.
  const draws: { uri: string; box: Box; frame: Box; page: number }[] = [];
  const fills: { box: Box; color: string }[] = [];
  const waiting: { frame: Box; page: number }[] = [];
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
      const size = knownPageSize(p.uri);
      if (!size) {
        waiting.push({ frame, page: p.page });
        continue;
      }
      const box = hugged(size, frame, hug);
      draws.push({ uri: p.uri, box, frame, page: p.page });
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
    const frame = { x: 0, y: 0, width, height };
    if (!size) {
      waiting.push({ frame, page: p.page });
    } else {
      // At its rest, as the pager draws it: contained, then scaled and set at its edge where it
      // rests zoomed (a wide page fitted to the height).
      const rest = pageRest(size, viewport, pageFit, false, rtl, false);
      const off = edgeOffset(rest.restEdge, panLimits(rest.restScale, rest.content, viewport));
      const w = rest.content.width * rest.restScale;
      const h = rest.content.height * rest.restScale;
      draws.push({ uri: p.uri, box: { x: (width - w) / 2 + off.x, y: (height - h) / 2 + off.y, width: w, height: h }, frame, page: p.page });
    }
  }

  const images = await Promise.all(draws.map((d) => page(d.uri, Math.ceil(d.box.width * SCALE))));
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
    const image = images[i];
    if (image) canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), px(d.box), paint);
    else waiting.push({ frame: d.frame, page: d.page });
  });
  for (const w of waiting) drawPlaceholder(canvas, w.frame, w.page, px);
  const picture = surface.makeImageSnapshot();
  surface.dispose();
  return { image: picture, complete: waiting.length === 0 };
}
