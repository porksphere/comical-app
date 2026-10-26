import { useEffect, useEffectEvent, useRef } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, type ViewInstance } from 'react-native';

import { openCollectionPicker } from '@/components/collection-picker';
import { BookmarkIcon } from '@/components/icons/reader-icons';
import { openSpreadPick, type SpreadPickRequest, type SpreadSide } from '@/components/reader/spread-pick';
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
  /** A page's image URL right now. A re-anchor key server-side; expected to rot, never rendered. */
  sourceUrlOf: (pageIndex: number) => string | undefined;
  /** The pages on screen with `pageIndex`, in reading order: two on a spread, where a save has to
   *  ask which. Asked at the press, since the pager's pairing isn't render state up here. */
  pagesOnScreen?: () => OnScreen;
};

type OnScreen = { pages: number[]; rtl: boolean };

const MENU_GAP = 6;

function useCollectPage({
  bridgeId,
  seriesId,
  seriesTitle,
  chapterId,
  chapterName,
  pageIndex,
  pageCount,
  sourceUrlOf,
  pagesOnScreen,
}: CollectPageProps) {
  // expo-image's disk-cache key is the URI actually handed to `<Image>`, which is the RESOLVED
  // asset source — the reader resolves a bridge's relative page path before rendering it. Peeking
  // the same memo the reader filled avoids threading the string up through the pager; a miss (or
  // web, where the rendered source can be an object URL) just means no hash, which is safe.
  const cacheKeyOf = (page: number) => {
    const url = sourceUrlOf(page);
    return url ? (peekResolvedAssetSource(url) ?? null) : null;
  };

  const snapshot = (page: number) => {
    const sourceUrl = sourceUrlOf(page);
    return {
      seriesTitle,
      ...(chapterName !== undefined && { chapterName }),
      ...(pageCount !== undefined && { pageCount }),
      ...(sourceUrl !== undefined && { sourceUrl }),
    };
  };

  const { isCollected, toggle } = usePageCollected(bridgeId, seriesId ?? '', chapterId, snapshot, cacheKeyOf);

  const openPicker = (page: number) => {
    if (!bridgeId || !seriesId || !chapterId) return;
    openCollectionPicker({
      kind: 'page',
      bridgeId,
      seriesId,
      chapterId,
      pageIndex: page,
      title: chapterName ? `${seriesTitle} — ${chapterName}` : seriesTitle,
      snapshot: () => snapshot(page),
    });
  };

  const save = (page: number, announce: boolean) => {
    const result = toggle(page);
    if (result === 'saved' && announce) showToast('Page saved');
    else if (result === 'pick') openPicker(page);
  };

  const spread = (): OnScreen | null => {
    const shown = pagesOnScreen?.();
    return shown && shown.pages.length > 1 ? shown : null;
  };

  // Which page of a spread, by the side it is on, since that is what the reader sees. A save can take
  // both; filing is one page at a time, so the picker only offers the sides.
  const spreadMenu = (
    { pages, rtl }: OnScreen,
    intent: 'save' | 'pick',
    at: Pick<SpreadPickRequest, 'under' | 'keyboard'>,
  ) => {
    const [l, r] = rtl ? [pages[1]!, pages[0]!] : [pages[0]!, pages[1]!];
    const side = (page: number): SpreadSide => ({ page, saved: !!isCollected(page) });
    openSpreadPick({
      ...at,
      title: intent === 'pick' ? 'Choose collections for' : 'Save',
      sides: [side(l), side(r)],
      onSide: (k) => {
        const page = k === 0 ? l : r;
        if (intent === 'pick') openPicker(page);
        else save(page, true);
      },
      ...(intent === 'save' && {
        onBoth: () => {
          const unsaved = pages.filter((page) => !isCollected(page));
          for (const page of unsaved) toggle(page);
          showToast(unsaved.length > 1 ? 'Pages saved' : 'Page saved');
        },
      }),
    });
  };

  return { collected: isCollected(pageIndex), save, openPicker, spread, spreadMenu };
}

/**
 * The reader chrome's save-this-page button, left of the settings gear in the toolbar's trailing
 * slot.
 *
 * **Tap** saves the page, unfiled; on a saved page it opens the picker, where it is filed or
 * removed. **Long press** opens the picker outright. On a spread either one first asks which page.
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
  const { collected, save, openPicker, spread, spreadMenu } = useCollectPage(page);
  const ref = useRef<ViewInstance>(null);
  const { width: winW } = useWindowDimensions();

  // Hung from the button like a dropdown, right edge to the button's.
  const menuFromButton = (shown: OnScreen, intent: 'save' | 'pick') =>
    ref.current?.measure((_x, _y, w, h, pageX, pageY) =>
      spreadMenu(shown, intent, { under: { right: winW - pageX - w, top: pageY + h + MENU_GAP }, keyboard: false }),
    );

  return (
    <Pressable
      ref={ref}
      testID="reader.toolbar.collect-page"
      onPress={() => {
        onPress?.();
        const shown = spread();
        if (shown) menuFromButton(shown, 'save');
        else save(page.pageIndex, false);
      }}
      onLongPress={() => {
        onPress?.();
        hapticImpactLight();
        const shown = spread();
        if (shown) menuFromButton(shown, 'pick');
        else openPicker(page.pageIndex);
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
 * picker — and says so, since nothing else on a hidden chrome would. On a spread it asks which page,
 * which a move key answers outright (`installSpreadPickKeys`). Rendered once per screen, apart from the button:
 * the reader's chrome can be mounted twice over.
 */
export function CollectPageShortcut({ enabled, ...page }: CollectPageProps & { enabled: boolean }) {
  const { save, spread, spreadMenu } = useCollectPage(page);
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!isKey(e, 'save')) return;
    if (e.repeat || e.defaultPrevented || isTypingTarget(e.target)) return;
    e.preventDefault();
    const shown = spread();
    if (shown) spreadMenu(shown, 'save', { keyboard: true });
    else save(page.pageIndex, true);
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
