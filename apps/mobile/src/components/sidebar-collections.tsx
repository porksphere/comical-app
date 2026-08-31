/**
 * The Collections group for the sidebar — Library's scope, nested under Library.
 *
 * The same shape as `sidebar-bridges`, for the same reason: a collection is a SCOPE, not a
 * destination. Picking one changes what Library means rather than navigating somewhere new, so it
 * moves the shared selection and then goes to Library — a scope change you can't see is
 * indistinguishable from nothing happening.
 *
 * The `null` row is the front door, exactly as the synthetic `Comical` bridge is for Bridges: the
 * library's own grid is not a collection, but it is where "no collection" lands, and a group you can
 * leave without being able to return to is a dead end.
 */

import { SidebarSubItem } from '@/components/app-sidebar';
import { setSelectedCollection, useSelectedCollectionId } from '@/data/selected-collection';
import { useCollections } from '@/hooks/use-collections';
import { router } from '@/lib/nav';

export function SidebarCollections({ active, onNavigate }: { active?: boolean; onNavigate?: () => void }) {
  const selected = useSelectedCollectionId();
  const { collections } = useCollections();

  const rows: { id: string | null; name: string }[] = [{ id: null, name: 'All' }, ...collections];

  return (
    <>
      {rows.map((row) => (
        <SidebarSubItem
          key={row.id ?? 'all'}
          testID={`sidebar.collection.${row.id ?? 'all'}`}
          label={row.name}
          active={active === true && row.id === selected}
          onPress={() => {
            setSelectedCollection(row.id);
            router.navigate('/library');
            onNavigate?.();
          }}
        />
      ))}
    </>
  );
}
