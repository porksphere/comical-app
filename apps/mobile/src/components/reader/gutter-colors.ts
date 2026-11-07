import { observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { edgeColors, spreadColor, type EdgeColors, type Side } from '@/components/reader/gutter-bands';

/**
 * The colours a spread's padding takes (the `spreadFill` reader setting): the most frequent colour
 * along the edges it is beside (`spreadColor`), so a white margin stays white — the gutter one
 * colour from both pages' inner edges, each side its own page's outer edge.
 *
 * Read off the page as published, not off the screen: expo-image keeps the original it downloaded
 * on disk (`getCachePathAsync`), even when it draws a smaller decode, and a downloaded chapter's
 * page is a file already. The platform decodes it, shrunk to `SAMPLE_WIDTH` (expo-image-manipulator,
 * off the main thread: Skia's own decoders don't read AVIF, which sources serve), and the small PNG
 * that makes is read here. One page at a time.
 */

/** The width pages are shrunk to for reading: their edges, a few pixels in, are what is read. */
const SAMPLE_WIDTH = 160;
/** The strip read down each side, in pixels at that width: past a trimmer's line, then a few wide. */
const INSET = 1;
const DEPTH = 3;
/** A page loaded but not yet on disk is looked for again once, this much later. */
const RETRY_MS = 1500;

/** A page's two edges, counted. */
type PageEdges = { left: EdgeColors; right: EdgeColors };

// By page. `null`: tried, and nothing to read.
const edges$ = observable<Record<string, PageEdges | null>>({});
const queued = new Set<string>();
const queue: (() => Promise<void>)[] = [];
let running = false;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await job();
      // A turn in between: the JS side has its own work after a landing.
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  } finally {
    running = false;
  }
}

/** The page as a file: a downloaded page's own, or the original expo-image keeps on disk. */
export async function fileOf(uri: string): Promise<string | null> {
  if (uri.startsWith('file://')) return uri;
  const path = await Image.getCachePathAsync(uri);
  return path ? (path.startsWith('file://') ? path : `file://${path}`) : null;
}

// TEMPORARY: each page read, to Metro.
const trace = (uri: string, what: string) => {
  if (__DEV__) console.log(`[gutter] …${uri.slice(-28)}: ${what}`);
};

async function read(uri: string): Promise<PageEdges | null> {
  const file = await fileOf(uri);
  if (!file) {
    trace(uri, 'not on disk');
    return null;
  }
  const small = await ImageManipulator.manipulate(file).resize({ width: SAMPLE_WIDTH }).renderAsync();
  const png = await small.saveAsync({ format: SaveFormat.PNG, base64: true });
  small.release();
  if (!png.base64) return null;
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(png.base64));
  if (!image) {
    trace(uri, 'the shrunk page did not decode');
    return null;
  }
  try {
    const w = image.width();
    const h = image.height();
    const px = image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!px) return null;
    const left = edgeColors(px, w, h, INSET, DEPTH, 'left');
    const right = edgeColors(px, w, h, INSET, DEPTH, 'right');
    trace(uri, `${w}x${h}, left edge mostly ${spreadColor([left])}, right ${spreadColor([right])}`);
    return { left, right };
  } finally {
    image.dispose();
  }
}

/** A page's edge colours, once read; asked for as soon as `ready` (loaded, so its original is on
 *  disk). Null until then, and where it can't be read — the web build has no cache to read. */
function usePageEdges(uri: string | undefined, ready: boolean): PageEdges | null {
  const key = uri ?? '';
  const colors = useSelector(() => (key ? edges$[key].get() : undefined));
  useEffect(() => {
    if (!uri || !ready || Platform.OS === 'web' || queued.has(uri)) return;
    queued.add(uri);
    const attempt = (tries: number) => {
      queue.push(async () => {
        let result: PageEdges | null = null;
        try {
          result = await read(uri);
        } catch (e) {
          trace(uri, `threw ${String(e)}`);
        }
        // Drawn before its download was written to disk: looked for once more.
        if (!result && tries > 0) setTimeout(() => attempt(tries - 1), RETRY_MS);
        else edges$[uri].set(result);
      });
      void drain();
    };
    attempt(1);
  }, [uri, ready]);
  return (colors as PageEdges | null | undefined) ?? null;
}

/** One page of a spread, for its padding: whether it has loaded, and the side of it filled. */
export type FilledPage = { uri: string; ready: boolean; side: Side };

/**
 * The colours a spread of up to two pages is padded with, one per page, from the edges each fill
 * is beside: `shared` (the gutter) one colour for both, read from both pages' edges; otherwise each
 * page its own. Null for a page before anything it takes from has been read, which leaves the
 * reader's background.
 */
export function useSpreadColors(
  first: FilledPage | undefined,
  second: FilledPage | undefined,
  shared: boolean,
): [string | null, string | null] {
  const a = usePageEdges(first?.uri, !!first?.ready);
  const b = usePageEdges(second?.uri, !!second?.ready);
  return combine(first, a, second, b, shared);
}

function combine(
  first: { side: Side } | undefined,
  a: PageEdges | null | undefined,
  second: { side: Side } | undefined,
  b: PageEdges | null | undefined,
  shared: boolean,
): [string | null, string | null] {
  const edgeA = first && a ? a[first.side] : null;
  const edgeB = second && b ? b[second.side] : null;
  if (shared) {
    const both = spreadColor([edgeA, edgeB]);
    return [both, both];
  }
  return [spreadColor([edgeA]), spreadColor([edgeB])];
}

/** The same as `useSpreadColors`, outside React, from what has been read so far. */
export function spreadColorsNow(
  first: { uri: string; side: Side } | undefined,
  second: { uri: string; side: Side } | undefined,
  shared: boolean,
): [string | null, string | null] {
  const peek = (uri: string | undefined) => (uri ? (edges$[uri].peek() as PageEdges | null | undefined) : null);
  return combine(first, peek(first?.uri), second, peek(second?.uri), shared);
}
