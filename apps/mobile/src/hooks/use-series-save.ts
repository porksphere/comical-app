import { openCollectionPicker } from '@/components/collection-picker';
import type { LibrarySnapshot } from '@/data/api';
import { useItemCollections } from '@/hooks/use-item-collections';
import { hapticSelection } from '@/lib/haptics';

/**
 * THE per-series save control — one action, one button, wherever a series can be saved.
 *
 * A tap on an unsaved series saves it, unfiled. A tap on a saved one opens the collection picker,
 * which is where it gets filed and where "Remove from Library" lives — a saved series carries
 * progress, downloads and tracker links, so it is deliberately never one tap from gone.
 */
export function useSeriesSave(
  bridgeId: string | undefined,
  seriesId: string,
  snapshot: () => LibrarySnapshot,
  /** The series title, for the picker's subheading. */
  title: string,
  direct?: boolean,
) {
  const target = { kind: 'series', bridgeId, seriesId, snapshot, ...(direct !== undefined && { direct }) } as const;
  const { saved, setCollections, remove } = useItemCollections(target);

  const pick = () => openCollectionPicker({ ...target, title });

  return {
    /** `null` while loading — the control renders disabled rather than wrong. */
    saved,
    /** For the glyph-prefixed surfaces (the series screen's button, the reader panel's cell), which
     *  supply their own ✓/＋. */
    label: saved ? 'In Library' : 'Library',
    /** For the menu ROWS, which read as actions rather than states. */
    menuLabel: saved ? 'In Library' : 'Add to Library',
    /** Open the picker outright — the caret / submenu affordance. */
    pick,
    onPress: () => {
      if (!bridgeId || saved === null) return;
      if (saved) return pick();
      hapticSelection();
      setCollections([]);
    },
    remove,
  };
}
