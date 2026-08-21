import { useQueryClient } from '@tanstack/react-query';

import { openCollectionPicker } from '@/components/collection-picker';
import type { LibrarySnapshot } from '@/data/api';
import { resolveDefaultCollection } from '@/data/default-collection';
import { getDefaultCollectionId, setDefaultCollectionId } from '@/data/default-collection-store';
import { collectionsQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useItemCollections } from '@/hooks/use-item-collections';
import { hapticSelection } from '@/lib/haptics';

/**
 * THE per-series save control — one action, one button, wherever a series can be saved.
 *
 * There used to be two: "Add to Library" and "Add to collection", side by side on four surfaces.
 * The library dissolving into collections made them the same thing at different granularity — being
 * in the library IS being in at least one collection, and add-to-library was just collecting with a
 * preset destination. Two controls for one action, and the one people reached for couldn't tell
 * them what the other had done.
 *
 * ── It says LIBRARY, so it does Library ──
 *
 * A tap on an uncollected series puts it in the **default** collection — the one
 * `data/default-collection.ts` resolves, created on first use, and the same one a migrated shelf
 * lands in. Deterministic, and it matches the label.
 *
 * It deliberately does NOT follow the reader's Google Maps save, which files a page into whichever
 * collection pages were last filed into. That model needs the button to name its destination
 * ("Saved in Reading") for a tap to be predictable, and once the button says "Library" instead, a
 * silent last-used destination makes the label a lie: press ＋ Library, get "Reading". Pages keep
 * the Maps model (`usePageCollected`) because their button never claimed otherwise.
 *
 * A tap on a series that IS saved opens the picker, where the collections are changed or cleared.
 * A saved series is deliberately not one tap from gone — it carries progress, downloads and tracker
 * links, and Maps doesn't one-tap away a save either.
 *
 * Membership IS the saved state, so this reads the series' collections and nothing else, where the
 * old pair read that *and* a separate is-it-in-the-library check that could disagree with it.
 */
export function useSeriesSave(
  bridgeId: string | undefined,
  seriesId: string,
  snapshot: () => LibrarySnapshot,
  /** The series title, for the picker's subheading. */
  title: string,
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();

  const target = { kind: 'series', bridgeId, seriesId, snapshot } as const;
  const { collectionIds, loading, setCollections } = useItemCollections(target);

  /** `null` while the membership is loading — the control renders disabled rather than wrong. */
  const saved = loading ? null : collectionIds.length > 0;
  const pick = () => openCollectionPicker({ ...target, title });

  return {
    saved,
    /** For the glyph-prefixed surfaces (the series screen's button, the reader panel's cell), which
     *  supply their own ✓/＋ — matching what those two showed before the merge. */
    label: saved ? 'In Library' : 'Library',
    /** For the menu ROWS, which read as actions rather than states. No "Remove from Library": a tap
     *  on a saved series opens the picker now, it doesn't remove. */
    menuLabel: saved ? 'In Library' : 'Add to Library',
    /** Open the picker outright — the caret / submenu affordance. */
    pick,
    onPress: async () => {
      if (!bridgeId || saved === null) return;
      // Saved → the picker owns every change from here, including removal.
      if (saved) return pick();
      hapticSelection();
      // Through the query cache, not a bare `ds.getCollections()`: the collections list is server
      // state, so this reuses the entry the picker and the library selector already populated
      // instead of putting a round trip in front of every tap.
      const destination = await resolveDefaultCollection({
        list: () => queryClient.fetchQuery(collectionsQuery(ds, mock)),
        create: (name) => ds.createCollection(name),
        rename: (id, name) => ds.renameCollection(id, name),
        storedId: getDefaultCollectionId,
        remember: setDefaultCollectionId,
      });
      setCollections([destination]);
    },
  };
}
