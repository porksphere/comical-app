import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { pageTranslationQuery, pipelineStateQuery } from '@/translation';
import { useTranslationSettings } from '../settings';
import { mapRegionToView } from './overlay-geometry';
import { RegionBubble } from './region-bubble';

/**
 * The translated-text overlay for one reader page. Rendered as an absoluteFill sibling of
 * `<ReaderPage>` INSIDE the zoom transform's Animated.View, so pan/pinch carry it with the
 * page for free; it holds no state of its own (webtoon rows unmount off-screen) — everything
 * comes from the query cache the scheduler writes into.
 *
 * `fit` mirrors ReaderPage's: 'contain' letterboxes inside `width`x`height`; 'width' fills the
 * width with height from the image aspect. Results are in image pixels (the frame recorded in
 * the PageTranslation itself, so mapping never depends on load-event timing).
 */
export function TranslationOverlay({
  pageKey,
  width,
  height,
  fit,
}: {
  pageKey: string;
  width: number;
  /** Container height; ignored for fit='width' (the row is width/aspect tall). */
  height: number;
  fit: 'contain' | 'width';
}) {
  const [{ targetLang }] = useTranslationSettings();
  const { data: result } = useQuery(pageTranslationQuery(pageKey, targetLang));
  const { data: pipeline } = useQuery(pipelineStateQuery(pageKey));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="reader.translation.overlay">
      {result
        ? result.regions.map((region) => {
            const frame = mapRegionToView(region.bbox, result, width, height, fit);
            if (!frame) return null;
            return <RegionBubble key={region.id} region={region} frame={frame} />;
          })
        : null}
      {pipeline?.state === 'running' ? (
        <View style={[styles.chip, styles.running]} pointerEvents="none">
          <Text style={styles.chipText}>translating…</Text>
        </View>
      ) : null}
      {pipeline?.state === 'error' ? (
        <View style={[styles.chip, styles.error]} pointerEvents="none">
          <Text style={styles.chipText}>translation failed</Text>
        </View>
      ) : null}
      {result?.partial ? (
        <View style={[styles.chip, styles.partial]} pointerEvents="none">
          <Text style={styles.chipText}>language pack needed</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  running: { backgroundColor: 'rgba(0,0,0,0.55)' },
  error: { backgroundColor: 'rgba(120,20,20,0.7)' },
  partial: { backgroundColor: 'rgba(120,90,20,0.7)' },
  chipText: { color: 'rgba(255,255,255,0.9)', fontSize: 11 },
});
