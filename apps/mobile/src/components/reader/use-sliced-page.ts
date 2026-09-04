import { Image } from 'expo-image';
import type { ImageRef } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { Size } from '@/components/reader/page-geometry';
import { sliceCount, sliceRects } from '@/components/reader/page-slicing';
import { logDiagnostic } from '@/lib/diagnostics';

/**
 * ONE page is cut up at a time, app-wide.
 *
 * A cut holds the whole picture and its finished pieces at once — briefly twice the page, and the
 * pages this runs on are the biggest in the chapter (30MB+ decoded is ordinary for a stitched
 * strip). A reader windows several rows ahead, so without this every tall page in the window would
 * start together and the transient peak would be that doubled cost times the whole window. Nothing
 * here is latency-sensitive enough to be worth that: the page is already on screen, whole, on any
 * device that can draw it.
 */
/**
 * The manipulator is loaded ON FIRST USE, never at import.
 *
 * `expo-image-manipulator` binds its native counterpart while its own module is being evaluated
 * (`requireNativeModule('ExpoImageManipulator')` at the top level), so a plain import throws in any
 * build whose native shell predates the dependency — and since `reader-page` imports this file,
 * that throw lands on OPENING THE READER, not on meeting a page that needs cutting. A blank strip
 * is the bug this feature exists to fix; a reader that won't open is a worse one.
 *
 * Behind the deferred load it is an ordinary slicing failure: caught, logged, and the page is drawn
 * whole, which is precisely the behaviour from before any of this existed. The promise is cached
 * including its rejection, so a shell that can't provide the module is asked exactly once.
 */
let manipulator: Promise<typeof import('expo-image-manipulator')> | null = null;
function loadManipulator() {
  manipulator ??= import('expo-image-manipulator');
  return manipulator;
}

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // The chain must not be poisoned by a rejection, and must not hold the RESULT alive either —
  // `catch` gives the next link a resolved promise carrying nothing.
  queue = next.catch(() => {});
  return next;
}

/**
 * Cuts a stitched webtoon strip into pieces small enough to actually draw — see `page-slicing.ts`
 * for the rule, and for what happens on a device that can't draw one.
 *
 * ANDROID ONLY, and that is the correction of an earlier mistake rather than a platform quirk.
 * Android is the only platform that CANNOT DRAW a strip: a browser tiles a large image itself, and
 * iOS renders a 10000px page correctly today. The first cut of this ran on iOS too, on the theory
 * that it would bound per-slice memory — which is backwards. Slicing costs a SECOND full decode of
 * the largest picture in the chapter (`Image.loadAsync`) plus the pieces, held at the same time, on
 * top of the copy the view already has and the full-size one in expo-image's memory cache. It
 * raises the peak on a platform that had nothing to gain, and it crashed the reader on a real
 * webtoon. Where the page draws, leave it alone.
 *
 * It runs OFF THE ALREADY-LOADED PAGE rather than ahead of it. Deciding before the first render
 * would mean knowing the picture's shape before it has arrived, which costs either a decode of
 * every page in the chapter or a range request per page to read a header — both paid on the great
 * majority of pages, which need nothing. So a page loads exactly as it always did, reports its real
 * dimensions, and only one that trips the rule is loaded a second time (from expo-image's own
 * cache, not the network) and cut. The visible cost is the one this ordering can't avoid: on a
 * device that couldn't draw the strip, the page is blank until the slices land.
 *
 * The slices are `ImageRef`s — native bitmaps handed straight to `<Image source>` — so nothing is
 * written to disk, re-downloaded, or re-encoded.
 */
export function useSlicedPage(source: string | null, image: Size | null, enabled: boolean): ImageRef[] | null {
  const [slices, setSlices] = useState<ImageRef[] | null>(null);
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect IS an async load, and dropping the previous page's pieces is its first step; leaving them set would draw one page's slices over another's.
    setSlices(null);
    if (Platform.OS !== 'android' || !enabled || !source || !(width > 0) || !(height > 0)) return;

    const count = sliceCount({ width, height });
    if (count < 2) return;

    let cancelled = false;
    void enqueue(async () => {
      // Re-checked HERE, not just at the top: this may have sat in the queue behind other pages
      // long enough for its own to be scrolled past, and the work is then nobody's.
      if (cancelled) return;
      const startedAt = Date.now();
      try {
        const { ImageManipulator } = await loadManipulator();
        // NOT released by hand when the crops are done, however tempting: a context keeps the
        // picture it was made from — that is what its own `reset()` goes back to — and the contexts
        // made here are unreferenced but not necessarily collected. `release` detaches a shared
        // object's native half, and its own documentation asks you to be sure nothing else will use
        // it; several live contexts holding this one is not that. It is ordinary garbage instead,
        // like the pieces.
        const whole = await Image.loadAsync(source);
        const out: ImageRef[] = [];
        for (const rect of sliceRects({ width, height })) {
          const piece = await ImageManipulator.manipulate(whole).crop(rect).renderAsync();
          if (cancelled) return;
          out.push(piece);
        }
        setSlices(out);
        logDiagnostic('reader-page', `sliced ${width}x${height} into ${count}`, {
          url: source,
          context: `${Date.now() - startedAt}ms`,
        });
      } catch (err) {
        // Deliberately NOT fed to the page's retry backoff: the original image loaded fine, and on
        // a platform that can draw it there is nothing wrong with the page at all. Falling back to
        // the whole picture is exactly the behaviour from before slicing existed.
        if (!cancelled) {
          logDiagnostic('reader-page', `slice failed: ${(err as Error)?.message ?? 'unknown'}`, {
            url: source,
            context: `${width}x${height} into ${count}`,
          });
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [source, width, height, enabled]);

  return slices;
}
