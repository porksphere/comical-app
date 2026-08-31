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
import { use$ } from '@legendapp/state/react';

import { SidebarSection, SidebarSubItem } from '@/components/app-sidebar';
import { setSelectedCollection, useSelectedCollectionId } from '@/data/selected-collection';
import { useCollections } from '@/hooks/use-collections';
import { router } from '@/lib/nav';
import { persisted$ } from '@/lib/observable';

const collectionsOpen$ = persisted$('comical:sidebarCollectionsOpen', true);

/** The one safe shape for reading an observable — see `sidebar-bridges.tsx`. */
function useCollectionsOpen(): boolean {
  return use$(collectionsOpen$);
}

export function SidebarCollections({ onNavigate }: { onNavigate?: () => void }) {
  const open = useCollectionsOpen();
  const selected = useSelectedCollectionId();
  const { collections } = useCollections();

  const rows: { id: string | null; name: string }[] = [{ id: null, name: 'All' }, ...collections];

  return (
    <SidebarSection label="Collections" open={open} onToggle={() => collectionsOpen$.set(!open)}>
      {rows.map((row) => (
        <SidebarSubItem
          key={row.id ?? 'all'}
          testID={`sidebar.collection.${row.id ?? 'all'}`}
          label={row.name}
          active={row.id === selected}
          onPress={() => {
            setSelectedCollection(row.id);
            router.navigate('/library');
            onNavigate?.();
          }}
        />
      ))}
    </SidebarSection>
  );
}
