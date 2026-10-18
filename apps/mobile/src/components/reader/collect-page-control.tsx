import { useEffect, useEffectEvent } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { openCollectionPicker } from '@/components/collection-picker';
import { BookmarkIcon } from '@/components/icons/reader-icons';
import { showToast } from '@/components/toast';
import { peekResolvedAssetSource } from '@/data/api';
import { usePageCollected } from '@/hooks/use-page-collected';
import { hapticImpactLight } from '@/lib/haptics';
import { isTypingTarget } from '@/lib/key-hold';
import { isKey } from '@/lib/keybindings';

type CollectPageProps = {
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
};

function useCollectPage({
  bridgeId,
  seriesId,
  seriesTitle,
  chapterId,
  chapterName,
  pageIndex,
  pageCount,
  sourceUrl,
}: CollectPageProps) {
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

  return { collected, toggle, openPicker };
}

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
  onPress,
  ...page
}: CollectPageProps & {
  /** Called on press so the caller can restart the chrome's auto-hide countdown — otherwise the
   *  bar can fade out from under the finger just as it's tapped. */
  onPress?: () => void;
}) {
  const { collected, toggle, openPicker } = useCollectPage(page);

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

/**
 * The save button's key (web, lib/keymap's `save`): it does what a tap does — saves the page, or on a saved one opens the
 * picker — and says so, since nothing else on a hidden chrome would. Rendered once per screen, apart
 * from the button: the reader's chrome can be mounted twice over.
 */
export function CollectPageShortcut({ enabled, ...page }: CollectPageProps & { enabled: boolean }) {
  const { toggle, openPicker } = useCollectPage(page);
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!isKey(e, 'save')) return;
    if (e.repeat || e.defaultPrevented || isTypingTarget(e.target)) return;
    e.preventDefault();
    const result = toggle();
    if (result === 'saved') showToast('Page saved');
    else if (result === 'pick') openPicker();
  });
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled]);
  return null;
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
