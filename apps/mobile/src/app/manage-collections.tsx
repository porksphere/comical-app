import { StyleSheet, View } from 'react-native';

import { AddFab } from '@/components/add-fab';
import { openConfirm } from '@/components/confirm-popup';
import { NamePromptForm } from '@/app/custom-pages';
import { PencilIcon, TrashIcon } from '@/components/icons/ui-icons';
import { useOverlay } from '@/components/overlay/overlay';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { showToast } from '@/components/toast';
import { SettingsGutter, Spacing } from '@/constants/theme';
import type { Collection } from '@/data/types';
import { useCollections } from '@/hooks/use-collections';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useRouter } from '@/lib/nav';

/**
 * The collections manager, pushed from the Library tab's selector ("Manage collections…"). Create,
 * rename, delete, and reorder collections. Reorder is the app's standard `ReorderableList` (styled
 * lift + neighbours spring apart, from a long-press on touch or the hover handle with a mouse).
 * Deleting a collection strips it from every member and PRUNES series/chapter favorites left with
 * none (the backend cascades). Mirrors `custom-pages.tsx`.
 */
export default function ManageCollectionsScreen() {
  const router = useRouter();
  const contentPadding = useSettingsScrollPadding();
  const { open } = useOverlay();
  const { collections, createCollection, renameCollection, reorderCollections, deleteCollection } = useCollections();

  const openCreate = () =>
    open(() => (
      <NamePromptForm
        title="New collection"
        placeholder="Collection name"
        submitLabel="Create"
        onSubmit={(name) => {
          void createCollection(name);
          showToast('Collection created');
        }}
      />
    ));

  const openRename = (id: string, name: string) =>
    open(() => (
      <NamePromptForm
        title="Rename collection"
        placeholder="Collection name"
        submitLabel="Rename"
        initialValue={name}
        onSubmit={(next) => renameCollection(id, next)}
      />
    ));

  const confirmDelete = (id: string, name: string) =>
    openConfirm({
      // There is no longer any asymmetry to explain: the library dissolved into collections, so a
      // series is in the library by virtue of being in one — and anything whose last collection
      // this was goes with it, series included. The host runs that cascade; the user should know
      // first.
      //
      // What this must NOT say is that they lose their place. Read progress deliberately survives
      // the cascade — precisely because tidying shelves can now remove a series, and that is the
      // one thing the user can't get back. Re-add the series and the reader is where it was.
      message: `“${name}” will be removed. Anything in it that isn’t in another collection — series, chapters and saved pages — leaves your library. Your reading progress is kept.`,
      confirmLabel: 'Delete Collection',
      onConfirm: () => {
        deleteCollection(id);
        showToast('Collection deleted');
      },
    });

  const renderRow = (c: Collection) => (
    <SwipeableSettingsRow
      label={c.name}
      recycleKey={c.id}
      testID={`manage-collections.row.${c.id}`}
      onPress={() => openRename(c.id, c.name)}
      actions={[
        { label: 'Rename', icon: PencilIcon, onPress: () => openRename(c.id, c.name) },
        { label: 'Delete', icon: TrashIcon, destructive: true, onPress: () => confirmDelete(c.id, c.name) },
      ]}
    />
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Manage Collections" onBack={() => router.back()} />

      {collections.length === 0 ? (
        <View style={[styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No collections yet. Create one with the + button, then file series into it from a series page or a
            card&apos;s long-press menu.
          </ThemedText>
        </View>
      ) : (
        <ReorderableList data={collections} keyOf={(l) => l.id} renderRow={renderRow} onReorder={reorderCollections} />
      )}

      <AddFab onPress={openCreate} testID="manage-collections.add" label="New collection" right={SettingsGutter} bottom={Spacing.five} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 340,
  },
});
