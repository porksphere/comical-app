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
 * **Tap** saves the page, unfiled; on a saved page it opens the picker, where it is filed or
 * removed. **Long press** opens the picker outright.
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
        if (toggle() === 'pick') openPicker();
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
      accessibilityLabel={collected ? 'Saved page — choose collections' : 'Save page'}>
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
