import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { WarnIcon } from '@/components/icons/reader-icons';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { invalidateAssetSource, resolveAssetSourceCached } from '@/data/api';
import { coverDelayMs } from '@/data/mock';
import { logDiagnostic } from '@/lib/diagnostics';

// One page image. Reuses the cover/thumbnail loading treatment: hold the image
// behind a simulated network delay and shimmer a skeleton until it's both
// elapsed and loaded; on error, retry automatically with increasing backoff,
// then fall back to a placeholder with a manual Retry tap.
//  - fit "contain": fills a fixed full-screen box (Paged mode).
//  - fit "width": fills the width; height derives from the image aspect (Webtoon).

const DEFAULT_ASPECT = 2 / 3; // width / height before the image reports its size
const RETRY_DELAYS_MS = [1000, 2000, 4000];

type LoadEvent = { source?: { width?: number; height?: number } | null };

export function ReaderPage({
  uri,
  page,
  fit,
  width,
  height,
  onLoadDims,
  onFailedChange,
}: {
  uri: string;
  page: number;
  fit: 'contain' | 'width';
  width: number;
  height?: number;
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
  const [resolvedUri, setResolvedUri] = useState<string | null>(null);
  // `coverDelayMs` self-gates on mock mode (0 in real mode), so real pages get no fake latency.
  const delay = useMemo(() => coverDelayMs(uri), [uri]);
  const [delayPassed, setDelayPassed] = useState(delay === 0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setResolvedUri(null);
    if (attempt > 0) invalidateAssetSource(uri);
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

  const ready = delayPassed && loaded;
  const box: StyleProp<ViewStyle> = fit === 'contain' ? { width, height } : { width, aspectRatio: aspect };

  if (failed) {
    return (
      <Pressable
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
        <View style={styles.retryChip}>
          <ThemedText style={styles.retryChipText}>Retry</ThemedText>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.box, box]}>
      {delayPassed && !retrying && resolvedUri && (
        <Image
          key={attempt}
          source={{ uri: resolvedUri }}
          style={StyleSheet.absoluteFill}
          contentFit={fit === 'contain' ? 'contain' : 'cover'}
          cachePolicy="memory-disk"
          transition={150}
          onLoad={(e: LoadEvent) => {
            setLoaded(true);
            const w = e.source?.width;
            const h = e.source?.height;
            if (w && h) {
              setAspect(w / h);
              onLoadDims?.(w, h);
            }
          }}
          onError={handleError}
        />
      )}
      {!ready && <Skeleton style={StyleSheet.absoluteFill} />}
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
