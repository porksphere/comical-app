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
import { Spacing } from '@/constants/theme';
import type { Collection } from '@/data/types';
import { useCollections } from '@/hooks/use-collections';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';

/**
 * The collections manager, pushed from the Library tab's selector ("Manage collections…"). Create,
 * rename, delete, and reorder collections. Reorder is the app's standard `ReorderableList` (styled
 * lift + neighbours spring apart, from a long-press on touch or the hover handle with a mouse).
 * Deleting a collection only strips it from its members — they stay saved, unfiled. Mirrors
 * `custom-pages.tsx`.
 */
export default function ManageCollectionsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const { openDialog } = useOverlay();
  const { collections, createCollection, renameCollection, reorderCollections, deleteCollection } = useCollections();

  const openCreate = () =>
    openDialog(
      () => (
        <NamePromptForm
          title="New collection"
          placeholder="Collection name"
          submitLabel="Create"
          onSubmit={(name) => {
            void createCollection(name);
            showToast('Collection created');
          }}
        />
      ),
      { accessibilityLabel: 'New collection' },
    );

  const openRename = (id: string, name: string) =>
    openDialog(
      () => (
        <NamePromptForm
          title="Rename collection"
          placeholder="Collection name"
          submitLabel="Rename"
          initialValue={name}
          onSubmit={(next) => renameCollection(id, next)}
        />
      ),
      { accessibilityLabel: 'Rename collection' },
    );

  const confirmDelete = (id: string, name: string) =>
    openConfirm({
      message: `“${name}” will be removed. Everything in it stays in your library.`,
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
      <TopBar title="Manage Collections" />

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

      <AddFab onPress={openCreate} testID="manage-collections.add" label="New collection" right={contentPadding.paddingRight} bottom={Spacing.five} />
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
