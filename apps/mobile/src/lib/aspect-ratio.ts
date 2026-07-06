import { Image, type ImageRef } from 'expo-image';
import { useEffect, useState } from 'react';

/** Default cover/page-thumb aspect ratio (width / height) — the skeleton's
 *  fixed shape, and the vertical MAX every thumbnail is capped to. Mirrors
 *  the reference's fixed 2:3 card shape. */
export const DEFAULT_THUMB_ASPECT = 2 / 3;

/** Caps a loaded image's natural aspect ratio (width / height) so it never
 *  renders taller than the default 2:3 skeleton shape — a bridge's thumbnail
 *  can be flatter/wider than 2:3 (rendering shorter) but never gets to grow
 *  past the skeleton's height, so the slot a thumbnail sits in never has to
 *  grow to fit it. Falls back to the default when the ratio is missing or not
 *  a usable positive number. */
export function clampThumbAspect(ratio?: number | null): number {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return DEFAULT_THUMB_ASPECT;
  return Math.max(DEFAULT_THUMB_ASPECT, ratio);
}

export type PrefetchedImage = {
  /** Pass this straight to `<Image source={...}/>` once `settled` — it's
   *  already resolved in memory (a native image ref, or an in-memory blob on
   *  web), so displaying it costs no *extra* network request on top of the one
   *  this hook already made. `null` on a failed fetch, in which case callers
   *  should fall back to `{ uri }` and let the image's own `onLoad`/`onError`
   *  take over as if this hook weren't involved. */
  ref: ImageRef | null;
  /** Real (capped) aspect ratio once `ref` resolves; the default 2:3 until
   *  then or if the fetch failed. */
  aspect: number;
  /** True once the fetch has settled, successfully or not — callers should
   *  keep their skeleton up until this flips before mounting the real image. */
  settled: boolean;
};

const IDLE_STATE: PrefetchedImage = { ref: null, aspect: DEFAULT_THUMB_ASPECT, settled: false };

/**
 * Resolves `uri`'s real dimensions *before* any caller reveals the image, by
 * decoding it off-screen via `Image.loadAsync` instead of learning its shape
 * from the visible `<Image>`'s own `onLoad`. That matters: sizing the box
 * from the visible image's `onLoad` means the box necessarily starts at the
 * default shape and only resizes once the image is already on screen and
 * fading in — a visible "pops in, then shrinks" jump. Prefetching means the
 * box is already the right shape the very first frame the image appears.
 *
 * The resolved `ref` should be passed straight back to the visible `<Image
 * source={ref}>` (see `PrefetchedImage.ref`) rather than re-passing `{ uri }`
 * — since `ref` already wraps the decoded image in memory, displaying it
 * doesn't cost a second network request, it just reuses what this hook
 * already fetched.
 */
export function usePrefetchedImage(uri: string | null | undefined, enabled: boolean): PrefetchedImage {
  const [state, setState] = useState<PrefetchedImage>(IDLE_STATE);

  useEffect(() => {
    setState(IDLE_STATE);
    if (!enabled || !uri) return;
    let cancelled = false;
    Image.loadAsync({ uri })
      .then((ref) => {
        if (!cancelled) setState({ ref, aspect: clampThumbAspect(ref.width / ref.height), settled: true });
      })
      .catch(() => {
        if (!cancelled) setState({ ref: null, aspect: DEFAULT_THUMB_ASPECT, settled: true });
      });
    return () => {
      cancelled = true;
    };
  }, [uri, enabled]);

  return state;
}
