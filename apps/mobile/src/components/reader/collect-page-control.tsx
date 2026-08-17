import { Pressable, StyleSheet } from 'react-native';

import { openCollectionPicker } from '@/components/collection-picker';
import { BookmarkIcon } from '@/components/icons/reader-icons';
import { peekResolvedAssetSource } from '@/data/api';
import { usePageCollected } from '@/hooks/use-page-collected';
import { hapticImpactLight } from '@/lib/haptics';

/**
 * The reader chrome's save-this-page button, left of the settings gear in the toolbar's trailing
 * slot.
 *
 * **Tap** files the page into whichever collection pages were last filed into, and tapping again
 * removes it. **Long press** opens the picker to choose. When there is no last-used collection yet
 * — the first ever save, or the remembered one has been deleted — a tap opens the picker too, since
 * there is nowhere sensible to put it and nothing is ever auto-created.
 *
 * Like the rest of the reader chrome this is deliberately UNTHEMED — white on the dark gradient,
 * never `useTheme()`, because the reader stays dark whatever the app theme is.
 *
 * Disabled until the chapter's saved indices resolve, so a quick tap can't act on an unknown state
 * (the same gate `useFavorite`'s star uses).
 */
export function CollectPageControl({
  bridgeId,
  seriesId,
  seriesTitle,
  chapterId,
  chapterName,
  pageIndex,
  pageCount,
  sourceUrl,
  onPress,
}: {
  bridgeId?: string;
  seriesId?: string;
  seriesTitle: string;
  /** The chapter the VISIBLE page belongs to — mid-crossing that is a neighbouring segment, not the
   *  screen's current chapter. `undefined` until the reader reports its first page. */
  chapterId?: string;
  chapterName?: string;
  pageIndex: number;
  pageCount?: number;
  /** The page's image URL right now. A re-anchor key server-side; expected to rot, never rendered. */
  sourceUrl?: string;
  /** Called on press so the caller can restart the chrome's auto-hide countdown — otherwise the
   *  bar can fade out from under the finger just as it's tapped. */
  onPress?: () => void;
}) {
  // expo-image's disk-cache key is the URI actually handed to `<Image>`, which is the RESOLVED
  // asset source — the reader resolves a bridge's relative page path before rendering it. Peeking
  // the same memo the reader filled avoids threading the string up through the pager; a miss (or
  // web, where the rendered source can be an object URL) just means no hash, which is safe.
  const cacheKey = sourceUrl ? (peekResolvedAssetSource(sourceUrl) ?? null) : null;

  const snapshot = () => ({
    seriesTitle,
    ...(chapterName !== undefined && { chapterName }),
    ...(pageCount !== undefined && { pageCount }),
    ...(sourceUrl !== undefined && { sourceUrl }),
  });

  const { collected, toggle } = usePageCollected(
    bridgeId,
    seriesId ?? '',
    chapterId,
    pageIndex,
    snapshot,
    cacheKey,
  );

  const openPicker = () => {
    if (!bridgeId || !seriesId || !chapterId) return;
    openCollectionPicker({
      kind: 'page',
      bridgeId,
      seriesId,
      chapterId,
      pageIndex,
      title: chapterName ? `${seriesTitle} — ${chapterName}` : seriesTitle,
      snapshot,
    });
  };

  return (
    <Pressable
      testID="reader.toolbar.collect-page"
      onPress={() => {
        onPress?.();
        // A tap with no remembered destination isn't a failure — it's the first one, so ask.
        void toggle().then((result) => {
          if (result === 'needs-pick') openPicker();
        });
      }}
      onLongPress={() => {
        onPress?.();
        hapticImpactLight();
        openPicker();
      }}
      hitSlop={12}
      disabled={collected === null}
      style={styles.button}
      accessibilityRole="button"
      accessibilityState={{ selected: !!collected }}
      accessibilityLabel={collected ? 'Remove page from collection' : 'Save page to collection'}>
      <BookmarkIcon
        color={collected === null ? 'rgba(255,255,255,0.3)' : '#fff'}
        size={20}
        filled={!!collected}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
