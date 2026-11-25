/**
 * The Collections group for the sidebar — Library's scope, nested under Library.
 *
 * The same shape as `sidebar-bridges`, for the same reason: a collection is a SCOPE, not a
 * destination. Picking one changes what Library means rather than navigating somewhere new, so it
 * moves the shared selection and then goes to Library — a scope change you can't see is
 * indistinguishable from nothing happening.
 *
 * The All row is the front door, exactly as the synthetic `Comical` bridge is for Bridges:
 * the library's own grid is not a collection, but it is where "no collection" lands, and a group you
 * can leave without being able to return to is a dead end.
 */

import { StyleSheet } from 'react-native';

import { SidebarMoreRow, SidebarRow, SidebarThumbRadius, SidebarThumbSize } from '@/components/app-sidebar';
import { CollectionThumb } from '@/components/collections/collection-thumb';
import { libraryViews, setSelectedCollection, useSelectedCollectionId } from '@/data/selected-collection';
import { useCollections } from '@/hooks/use-collections';
import { useSectionOpen } from '@/hooks/use-sidebar-sections';
import { router } from '@/lib/nav';
import { foldSidebarRows } from '@/lib/sidebar-fold';

export function SidebarCollections({ active, onReselect }: { active?: boolean; onReselect?: () => void }) {
  const selected = useSelectedCollectionId();
  const { collections } = useCollections();

  const more = useSectionOpen(MORE, false);
  const views = libraryViews(collections);
  const fold = foldSidebarRows(
    views,
    views.findIndex((v) => v.id === selected),
    more,
  );

  return (
    <>
      {fold.rows.map((row) => (
        <SidebarRow
          key={row.id ?? 'all'}
          testID={`sidebar.collection.${row.testKey}`}
          label={row.name}
          active={active === true && row.id === selected}
          leading={<CollectionThumb view={row.id} name={row.name} size={SidebarThumbSize} style={styles.thumb} />}
          onPress={() => {
            if (active && row.id === selected) onReselect?.();
            setSelectedCollection(row.id);
            router.navigate('/library');
          }}
        />
      ))}
      {fold.hidden > 0 ? (
        <SidebarMoreRow section={MORE} open={more} hidden={fold.hidden} testID="sidebar.collections.more" />
      ) : null}
    </>
  );
}

const MORE = 'library-more';

const styles = StyleSheet.create({
  thumb: { borderRadius: SidebarThumbRadius },
});
