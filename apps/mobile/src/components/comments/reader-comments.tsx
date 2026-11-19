import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { CommentsSheet } from '@/components/comments/comments-sheet';
import { CommentsIcon } from '@/components/icons/ui-icons';
import { useOverlay } from '@/components/overlay/overlay';
import { useCommentScopes } from '@/data/comments-prefs';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';

/** Width of the toolbar's comments button, for the slot that holds it. */
export const COMMENTS_CONTROL_W = 32;

/**
 * The comments of what the reader is showing, behind its toolbar's button: the chapter's own thread,
 * or the series' for one with no chapters. `open` is undefined where the source keeps no thread for
 * it (or comments are off), and the button is then left out.
 *
 * A sheet over the reader rather than a page pushed on it, so the place in the chapter is never
 * given up. `onOpenChange` follows the sheet, for the reader to hold its chrome up under it.
 */
export function useReaderComments(
  target: { bridgeId?: string; seriesId?: string; chapterId?: string; chapterName?: string },
  onOpenChange?: (open: boolean) => void,
): { open: (() => void) | undefined } {
  const { bridgeId, seriesId, chapterId, chapterName } = target;
  const { openDialog, topId } = useOverlay();
  const { byId } = useBridgeMap();
  const scopes = useCommentScopes(bridgeId ? byId.get(bridgeId) : undefined);
  const chaptered = chapterId !== undefined && chapterId !== DIRECT_CHAPTER_ID;
  const available = !!bridgeId && !!seriesId && (chaptered ? scopes.chapter : chapterId === DIRECT_CHAPTER_ID && scopes.series);

  // State, not a ref: `isOpen` is read during render (see `useAnchoredOverlay`).
  const [sheetId, setSheetId] = useState<number | null>(null);
  const isOpen = sheetId !== null && sheetId === topId;
  useEffect(() => {
    if (!isOpen || !onOpenChange) return;
    onOpenChange(true);
    return () => onOpenChange(false);
  }, [isOpen, onOpenChange]);

  if (!available) return { open: undefined };
  return {
    open: () =>
      setSheetId(
        openDialog(
          () => (
            <CommentsSheet
              bridgeId={bridgeId}
              seriesId={seriesId}
              {...(chaptered && { chapterId })}
              {...(chapterName !== undefined && { name: chapterName })}
            />
          ),
          { accessibilityLabel: 'Comments' },
        ),
      ),
  };
}

/** The custom toolbar's comments button (Android and web; iOS has the system bar's, see
 *  `ReaderNativeToolbar`). */
export function CommentsControl({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="reader.comments.open"
      hitSlop={12}
      onPress={onPress}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="Comments">
      <CommentsIcon color="#fff" size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: COMMENTS_CONTROL_W,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
