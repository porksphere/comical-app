import { useQuery } from '@tanstack/react-query';

import { openCollectionPicker } from '@/components/collection-picker';
import type { LibrarySnapshot } from '@/data/api';
import { collectionsQuery } from '@/data/queries';
import { resolveLastCollection } from '@/data/last-collection';
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
 * **The Google Maps "Save" model**, which the reader's page save (`usePageCollected`) already
 * follows, so the two saves in this app work the same way:
 *
 * - **Unsaved** → a tap files it into whichever collection series were last filed into, and the
 *   button then NAMES that collection. Nothing is auto-created: with no usable last-used collection
 *   (nothing filed yet, or it has since been deleted) the tap opens the picker instead.
 * - **Saved** → a tap opens the picker, where the destination is changed or cleared. A saved series
 *   is deliberately NOT one tap from gone — it carries progress, downloads and tracker links, and
 *   Maps doesn't one-tap away a save either. (This is the one place the series control and the page
 *   control differ: a page is cheap to re-save, a series isn't.)
 *
 * Naming the destination is what makes the model legible — "Saved in Reading" tells you where it
 * went without opening anything, which "In Library" could never do once there were several.
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

  const target = { kind: 'series', bridgeId, seriesId, snapshot } as const;
  const { collectionIds, loading: membershipsLoading, setCollections } = useItemCollections(target);
  // Subscribed, not peeked, and part of the loading gate: the label names a collection and the tap
  // resolves its destination from this list, so both are wrong until it lands. Shares the one cache
  // entry the picker and the library selector already populate.
  const { data: collections, isLoading: collectionsLoading } = useQuery(collectionsQuery(ds, mock));

  /** `null` while either half is loading — the control renders disabled rather than wrong. */
  const saved = membershipsLoading || collectionsLoading ? null : collectionIds.length > 0;

  /** Where a one-tap save would go, or `undefined` when there is nowhere sensible. Validated
   *  against the live list, so a deleted collection falls through to the picker instead of
   *  resurrecting itself. */
  const destination = collections ? resolveLastCollection('series', collections) : undefined;

  // What it's saved IN, or null when that can't be named — filed in several, or filed somewhere the
  // list doesn't know about yet (mid-invalidation). Still saved either way, just unnameable.
  const where =
    saved !== true
      ? null
      : collectionIds.length > 1
        ? `${collectionIds.length} collections`
        : (collections?.find((c) => c.id === collectionIds[0])?.name ?? null);

  return {
    saved,
    /** "Save" when unsaved, "Saved in <collection>" when it can be named (callers add their own
     *  ✓/＋ glyph). */
    label: saved !== true ? 'Save' : where ? `Saved in ${where}` : 'Saved',
    /** Whether a tap will save outright rather than open the picker — for surfaces that show a
     *  different affordance for the two (the native menu's in-place submenu). */
    quickSaves: saved === false && destination !== undefined,
    /** Open the picker outright. */
    pick: () => openCollectionPicker({ ...target, title }),
    onPress: () => {
      if (!bridgeId || saved === null) return;
      if (saved || !destination) return openCollectionPicker({ ...target, title });
      hapticSelection();
      setCollections([destination]);
    },
  };
}
