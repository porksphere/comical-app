import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { WarnIcon } from '@/components/icons/reader-icons';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { coverDelayMs } from '@/data/mock';

// One page image. Reuses the cover/thumbnail loading treatment: hold the image
// behind a simulated network delay and shimmer a skeleton until it's both
// elapsed and loaded; on error show a static placeholder (retry is deferred).
//  - fit "contain": fills a fixed full-screen box (Paged mode).
//  - fit "width": fills the width; height derives from the image aspect (Webtoon).

const DEFAULT_ASPECT = 2 / 3; // width / height before the image reports its size

type LoadEvent = { source?: { width?: number; height?: number } | null };

export function ReaderPage({
  uri,
  page,
  fit,
  width,
  height,
}: {
  uri: string;
  page: number;
  fit: 'contain' | 'width';
  width: number;
  height?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const delay = useMemo(() => coverDelayMs(uri), [uri]);
  const [delayPassed, setDelayPassed] = useState(delay === 0);

  useEffect(() => {
    if (delay === 0) return;
    setDelayPassed(false);
    setLoaded(false);
    setFailed(false);
    const t = setTimeout(() => setDelayPassed(true), delay);
    return () => clearTimeout(t);
  }, [delay, uri]);

  const ready = delayPassed && loaded;
  const box: StyleProp<ViewStyle> = fit === 'contain' ? { width, height } : { width, aspectRatio: aspect };

  if (failed) {
    return (
      <View style={[styles.box, box, styles.failed]}>
        <WarnIcon color="rgba(255,255,255,0.5)" size={28} />
        <ThemedText style={styles.failedText}>Page {page}</ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.box, box]}>
      {delayPassed && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={fit === 'contain' ? 'contain' : 'cover'}
          transition={150}
          onLoad={(e: LoadEvent) => {
            setLoaded(true);
            const w = e.source?.width;
            const h = e.source?.height;
            if (w && h) setAspect(w / h);
          }}
          onError={() => setFailed(true)}
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
});
