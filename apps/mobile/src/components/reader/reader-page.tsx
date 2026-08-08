import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { WarnIcon } from '@/components/icons/reader-icons';
import { useImageProgress } from '@/components/reader/image-progress';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { invalidateAssetSource, peekResolvedAssetSource, resolveAssetSourceCached } from '@/data/api';
import { coverDelayMs } from '@/data/mock';
import { logDiagnostic } from '@/lib/diagnostics';
import { traceJS } from '@/lib/gesture-trace';
import { testId } from '@/lib/test-id';

// One page image. Reuses the cover/thumbnail loading treatment: hold the image
// behind a simulated network delay and shimmer a skeleton until it's both
// elapsed and loaded; on error, retry automatically with increasing backoff,
// then fall back to a placeholder with a manual Retry tap.
//  - fit "contain": fills a fixed full-screen box (Paged mode).
//  - fit "width": fills the width; height derives from the image aspect (Webtoon).
//
// While the skeleton is up it also reports what's actually happening: the download percentage
// (see `image-progress.ts` — bytes come from expo-image on native, from an XHR on web) and, once
// a load has failed, which retry we're on. Big pages on a slow source otherwise show a shimmer
// with no way to tell "downloading" from "stuck".

const DEFAULT_ASPECT = 2 / 3; // width / height before the image reports its size
const RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * The surface shown wherever a page isn't on screen yet. Exported because the pager paints the SAME
 * colour behind its (virtualized) list — see paged-reader.tsx's `PageBackdrop`.
 *
 * There are two ways a page can be missing and they used to look identical and like nothing at all:
 * a cell the list hasn't mounted yet showed the reader's own `#0f0f0f`, and a mounted-but-unloaded
 * one showed the skeleton's `rgba(128,128,128,0.18)` over it — about `#1a1a1a`, ten RGB values
 * away. Both read as "the reader went black". They're now one deliberate, clearly-lighter surface,
 * and the only difference between them is that a mounted page can say which page it is.
 *
 * TRANSLUCENT, not opaque, same alpha as the skeleton it sits alongside — this used to be a solid
 * `#1f1f24`, which showed up as a hard-edged rectangle riding along with the swipe-to-dismiss
 * gesture instead of blending into the backdrop behind it. A low-alpha fill lets that show
 * through. It's fine ON A PAGE (a page-sized tint moving with the page it belongs to is the page
 * moving); what must never exist is a full-SCREEN fill inside the pager, since that whole subtree
 * translates/scales during a swipe-away while the backdrop stays put.
 */
export const PAGE_SURFACE = 'rgba(31,31,36,0.18)';

/** The paged reader's static backdrop: PAGE_SURFACE flattened over the reader's base `#0f0f0f`
 *  (0.82·15 + 0.18·31 ≈ 18 / blue 0.18·36 ≈ 19 → #121213). The pager used to paint PAGE_SURFACE
 *  full-screen behind its list so a scrub that outruns virtualization shows "pages that haven't
 *  drawn yet" instead of a raw black gap — but that fill lived inside the subtree that
 *  translates/scales during swipe-to-dismiss, so it travelled with the receding page. Baking the
 *  same composite into the STATIC backdrop keeps scrub gaps and unloaded pages looking identical
 *  while only the pages themselves move during a swipe. */
export const PAGED_BACKDROP = '#121213';

/** The cross-fade for a page that is STANDING rather than being turned to — the series page's
 *  collapsed strip. Short on purpose: long enough that the page arrives rather than appears, short
 *  enough that it is over before you have read the title under it. */
export const STANDBY_FADE_MS = 180;

type LoadEvent = { source?: { width?: number; height?: number } | null };

export function ReaderPage({
  uri,
  page,
  fit,
  width,
  height,
  onLoadDims,
  onFailedChange,
  fadeMs,
}: {
  uri: string;
  page: number;
  fit: 'contain' | 'width';
  width: number;
  height?: number;
  /** Override the cross-fade below. The series page's strip passes STANDBY_FADE_MS: it holds ONE
   *  standing page with no turns to keep instant, so the rule below doesn't apply to it and a page
   *  that simply appears there reads as a pop next to the details settling in around it. */
  fadeMs?: number;
  /** Fires with the image's real pixel dimensions once it loads — lets a caller
   *  (webtoon mode's scroll-to-index estimate) refine its height guess for
   *  still-unloaded pages instead of relying solely on `DEFAULT_ASPECT`. */
  onLoadDims?: (width: number, height: number) => void;
  /** Fires when this page's failed (out-of-retries) state changes — lets a
   *  caller suspend its own tap-to-turn/tap-to-toggle-chrome overlay, which
   *  would otherwise sit on top of and swallow taps meant for the Retry chip. */
  onFailedChange?: (failed: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  // `uri` is the bridge's raw (possibly server-relative) page path — resolved lazily below, only once
  // this page has actually mounted (readers window their rows, so pages far off-screen never mount and
  // never resolve). This is what keeps a big gallery from resolving every page up front. `null` until
  // resolved; while null the skeleton shows.
  // Seeded from the synchronous peek: the warm-ahead prefetch has usually resolved this path
  // already (and an absolute URL resolves to itself, which is nearly all of them), and learning
  // that from the effect below instead cost every page an extra commit as a placeholder before the
  // <Image> could even mount.
  const [resolvedUri, setResolvedUri] = useState<string | null>(() => peekResolvedAssetSource(uri) ?? null);
  // `coverDelayMs` self-gates on mock mode (0 in real mode), so real pages get no fake latency.
  const delay = useMemo(() => coverDelayMs(uri), [uri]);
  const [delayPassed, setDelayPassed] = useState(delay === 0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Traced against the series page's `reveal commit` (lib/gesture-trace): a flash on the first
  // reveal into the reader is a question about WHEN this page had something to paint. Mounting
  // without a resolved uri means a skeleton until the effect below resolves it; `loaded` is the
  // first frame there is actually an image. Both are silent unless a recording is running.
  useEffect(() => {
    traceJS('page', 'mount', { p: page, resolved: !!resolvedUri });
    // Mount-only: the question is what this page had AT mount, not on later re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Assert delayPassed=true on no delay (not a bare return) so a key/delay change can't strand it
    // false after its pending timeout was cleared — mirrors the page-thumbnail fix.
    if (delay === 0) {
      setDelayPassed(true);
      return;
    }
    setDelayPassed(false);
    setLoaded(false);
    const t = setTimeout(() => setDelayPassed(true), delay);
    return () => clearTimeout(t);
  }, [delay, uri]);

  // A new page URI (paging away mid-retry) drops any pending retry and starts fresh.
  useEffect(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    setFailed(false);
    setAttempt(0);
    setRetrying(false);
  }, [uri]);

  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  useEffect(() => {
    onFailedChange?.(failed);
  }, [failed, onFailedChange]);

  const handleError = (e: { error?: string }) => {
    logDiagnostic('reader-page', e.error || 'load failed', {
      url: uri,
      context: `page=${page} attempt=${attempt + 1}/${RETRY_DELAYS_MS.length + 1}`,
    });
    if (attempt < RETRY_DELAYS_MS.length) {
      setRetrying(true);
      retryTimerRef.current = setTimeout(() => {
        setAttempt((a) => a + 1);
        setRetrying(false);
      }, RETRY_DELAYS_MS[attempt]);
    } else {
      setFailed(true);
    }
  };

  const handleManualRetry = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    invalidateAssetSource(uri); // re-resolve from scratch (a retry sets attempt→0, which alone wouldn't)
    setAttempt(0);
    setRetrying(false);
    setFailed(false);
    setLoaded(false);
  };

  // Resolve the raw page path lazily. Re-runs on every `attempt` bump (auto-retry), busting the cache
  // first so a stale/expired resolved URL is re-fetched rather than re-served. A resolve failure feeds
  // the same backoff as an image-load failure, so a page that can't be resolved retries then shows the
  // Retry chip like any other failure.
  useEffect(() => {
    let cancelled = false;
    // Don't tear a good URL down to re-derive the same answer: on a first attempt the seed above is
    // already correct whenever the peek knew it, and clearing it here would unmount the <Image>
    // for a frame. A retry (`attempt > 0`) deliberately does start from nothing.
    if (attempt > 0) {
      setResolvedUri(null);
      invalidateAssetSource(uri);
    } else {
      // Re-asserted rather than assumed: the seed belongs to whatever `uri` was at MOUNT, so a
      // changed one still has to say so (a no-op set when it agrees, which is the common case).
      const known = peekResolvedAssetSource(uri);
      if (known) {
        setResolvedUri(known);
        return;
      }
    }
    resolveAssetSourceCached(uri)
      .then((u) => {
        if (!cancelled) setResolvedUri(u);
      })
      .catch((err: unknown) => {
        if (!cancelled) handleError({ error: (err as Error)?.message || 'resolve failed' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, attempt]);

  // Byte-level download progress for the resolved URL. On web this also *is* the fetch (it hands
  // back an object URL), so `source` — not `resolvedUri` — is what the <Image> renders, and a
  // failure it detects has to feed the same backoff an <Image> onError would.
  const { source, percent, error: fetchError, imageProps } = useImageProgress(resolvedUri, attempt);

  const reportedRef = useRef(-1);
  useEffect(() => {
    // Guard per attempt: handleError bumps `attempt`, which re-arms the hook — without this, a
    // still-set error from the previous attempt would re-enter and burn the retries instantly.
    if (fetchError && reportedRef.current !== attempt) {
      reportedRef.current = attempt;
      handleError({ error: fetchError });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchError, attempt]);

  const ready = delayPassed && loaded;
  const box: StyleProp<ViewStyle> = fit === 'contain' ? { width, height } : { width, aspectRatio: aspect };

  // What the skeleton says while it's up. Nothing at all in the common case (a page that loads
  // promptly on the first try shouldn't flash a "0%"), a percentage once bytes are moving, and the
  // retry count the moment a load has actually failed — that's when the user starts wondering.
  const totalTries = RETRY_DELAYS_MS.length + 1;
  const status = retrying
    ? `Retrying… ${attempt + 1}/${RETRY_DELAYS_MS.length}`
    : percent !== null
      ? `${percent}%${attempt > 0 ? ` · try ${attempt + 1}/${totalTries}` : ''}`
      : attempt > 0
        ? `Try ${attempt + 1}/${totalTries}`
        : null;

  if (failed) {
    return (
      <Pressable
        testID={testId('reader.page.retry', page)}
        onPress={(e) => {
          // Web-only ancestors (the webtoon scroller's chrome-toggle onClick)
          // would otherwise also fire from this same tap via DOM bubbling.
          e.stopPropagation?.();
          handleManualRetry();
        }}
        style={[styles.box, box, styles.failed]}
        accessibilityRole="button"
        accessibilityLabel="Retry loading page">
        <WarnIcon color="rgba(255,255,255,0.5)" size={28} />
        <ThemedText style={styles.failedText}>Page {page}</ThemedText>
        <ThemedText style={styles.failedSubtext}>Gave up after {totalTries} tries</ThemedText>
        <View style={styles.retryChip}>
          <ThemedText style={styles.retryChipText}>Retry</ThemedText>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.box, box]}>
      {delayPassed && !retrying && source && (
        <Image
          key={attempt}
          source={{ uri: source }}
          style={StyleSheet.absoluteFill}
          contentFit={fit === 'contain' ? 'contain' : 'cover'}
          cachePolicy="memory-disk"
          // No cross-fade in paged mode. The page it fades UP FROM is the placeholder, so a page
          // that was actually ready still spent 150ms looking like one — the exact impression this
          // pass is trying to remove. Webtoon keeps it: rows arrive under a continuously moving
          // scroll, where a hard swap is the more jarring of the two. (Both are about PAGE TURNS;
          // a caller holding one standing page overrides with `fadeMs`.)
          transition={fadeMs ?? (fit === 'contain' ? 0 : 150)}
          // Hold animated pages (e.g. animated WebP) on their FIRST frame — do not autoplay. On iOS,
          // expo-image animates a WebP via a Core Animation keyframe animation that decodes each frame
          // on the MAIN THREAD inside the layer commit (Sentry COMICAL-APP-1E: CA::Transaction::commit
          // → CAKeyframeAnimation → WebPReadPlugin::decodeAnimatedWebP on thread 0). A large page's
          // frames block the main thread past the OS app-hang watchdog (≥2s) and the app is killed;
          // it's also very memory-heavy. There's no prop to move that decode off the main thread, so
          // the only safe option is not to play it. A poster frame decodes off-thread like any image.
          autoplay={false}
          onLoad={(e: LoadEvent) => {
            traceJS('page', 'loaded', { p: page });
            setLoaded(true);
            const w = e.source?.width;
            const h = e.source?.height;
            if (w && h) {
              setAspect(w / h);
              onLoadDims?.(w, h);
            }
          }}
          onError={handleError}
          {...imageProps}
        />
      )}
      {!ready && (
        // Laid over the box (absolute, centred) rather than inside it, so it can't affect the page's
        // measured height — webtoon mode derives row heights from that.
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} pointerEvents="none">
          <Skeleton style={StyleSheet.absoluteFill} />
          {/* Always named, not just once bytes are moving: "waiting to start" was the most common
              loading state and the one that said nothing at all. */}
          <ThemedText style={styles.placeholderPage}>Page {page}</ThemedText>
          {status && <ThemedText style={styles.statusText}>{status}</ThemedText>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
  },
  failed: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: '#1a1a1d',
  },
  failedText: {
    color: 'rgba(255,255,255,0.5)',
  },
  failedSubtext: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
  },
  placeholder: {
    backgroundColor: PAGE_SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  // Same treatment as the failed screen's "Page N" line — no pill/backdrop, just the text.
  placeholderPage: {
    color: 'rgba(255,255,255,0.5)',
  },
  // Secondary to the page name above it, like the failed screen's two lines.
  statusText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    fontVariant: ['tabular-nums'], // a ticking percentage shouldn't jitter its own width
  },
  retryChip: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  retryChipText: {
    color: '#fff',
    fontWeight: '600',
  },
});
