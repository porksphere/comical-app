import { useCallback, useState } from 'react';

// How a reader page learns *how much* of its image has downloaded (NATIVE).
//
// expo-image fires `onProgress` (loaded/total bytes) on iOS/Android, so the source we hand the
// <Image> is just the resolved URL and the percentage comes from the image itself. The web build
// has no such event and has to read the bytes itself — see `image-progress.web.ts`, which
// implements this same shape differently. Both return the same contract:
//
//   source     — what to actually give <Image> (null = nothing to render yet)
//   percent    — 0-100, or null when the size isn't known (never-computable, or not started)
//   error      — a load failure detected *by this hook* (web only); feeds the caller's retry
//   imageProps — extra props to spread onto <Image> (native: the onProgress handler)

export type ImageProgress = {
  source: string | null;
  percent: number | null;
  error: string | null;
  imageProps: { onProgress?: (e: { loaded: number; total: number }) => void };
};

/** Identifies which download a reported percentage belongs to. A new URI (paged away) or a bumped
 *  `attempt` (retry) is a *different* download, so any percentage still held from the old one is
 *  stale — it's discarded by key mismatch at read time rather than cleared in an effect, which
 *  would cost an extra render pass on every page mount. */
const keyOf = (uri: string | null, attempt: number) => `${uri ?? ''}#${attempt}`;

export function useImageProgress(uri: string | null, attempt: number): ImageProgress {
  const [reported, setReported] = useState<{ key: string; percent: number } | null>(null);
  const key = keyOf(uri, attempt);

  const onProgress = useCallback(
    (e: { loaded: number; total: number }) => {
      // Hold at 99 until `onLoad` — decode still has to happen after the last byte arrives, and
      // showing 100% over a still-blank page reads as a stall.
      if (e.total > 0) setReported({ key, percent: Math.min(99, Math.round((e.loaded / e.total) * 100)) });
    },
    [key],
  );

  return {
    source: uri,
    percent: reported?.key === key ? reported.percent : null,
    error: null,
    imageProps: { onProgress },
  };
}
