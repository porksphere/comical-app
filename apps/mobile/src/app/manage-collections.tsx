import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AddFab } from '@/components/add-fab';
import { openConfirm } from '@/components/confirm-popup';
import { NamePromptForm } from '@/app/custom-pages';
import { CheckIcon, GripIcon, PencilIcon, TrashIcon } from '@/components/icons/ui-icons';
import { useOverlay } from '@/components/overlay/overlay';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { showToast } from '@/components/toast';
import { SettingsGutter, Spacing } from '@/constants/theme';
import type { Collection } from '@/data/types';
import { useCollections } from '@/hooks/use-collections';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

const IS_WEB = Platform.OS === 'web';

/**
 * The collections manager, pushed from the Library tab's selector ("Manage collections…"). Create,
 * rename, delete, and reorder collections. Reorder is the app's standard `ReorderableList`: native
 * long-press drag (styled lift + neighbours spring apart), and a web ▲/▼ editing mode toggled from
 * the top bar (the drag library is native-only). Deleting a collection strips it from every member
 * and PRUNES series/chapter favorites left with none (the backend cascades). Mirrors
 * `custom-pages.tsx`.
 */
export default function ManageCollectionsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const { open } = useOverlay();
  const [editing, setEditing] = useState(false);
  const { collections, createCollection, renameCollection, reorderCollections, deleteCollection } = useCollections();
  const canReorder = collections.length >= 2;

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
      message: `“${name}” will be removed. The series in it stay in your library.`,
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
      <TopBar
        title="Manage Collections"
        onBack={() => router.back()}
        right={
          editing ? (
            <TopBarButton
              testID="manage-collections.done"
              icon={<CheckIcon color={theme.text} size={22} />}
              label="Done reordering"
              onPress={() => setEditing(false)}
            />
          ) : IS_WEB && canReorder ? (
            <TopBarButton
              testID="manage-collections.reorder"
              icon={<GripIcon color={theme.text} size={22} />}
              label="Reorder collections"
              onPress={() => setEditing(true)}
            />
          ) : undefined
        }
      />

      {collections.length === 0 ? (
        <View style={[styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No collections yet. Create one with the + button, then file series into it from a series page or a
            card&apos;s long-press menu.
          </ThemedText>
        </View>
      ) : (
        <ReorderableList
          data={collections}
          keyOf={(l) => l.id}
          renderRow={renderRow}
          label={(l) => l.name}
          onReorder={reorderCollections}
          editing={editing}
        />
      )}

      {!editing && (
        <AddFab onPress={openCreate} testID="manage-collections.add" label="New collection" right={SettingsGutter} bottom={Spacing.five} />
      )}
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
