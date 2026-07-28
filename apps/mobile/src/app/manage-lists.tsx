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
import type { LibraryList } from '@/data/types';
import { useLibraryLists } from '@/hooks/use-library-lists';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

const IS_WEB = Platform.OS === 'web';

/**
 * The custom-lists manager, pushed from the Library tab's list selector ("Manage lists…"). Create,
 * rename, delete, and reorder lists. Reorder is the app's standard `ReorderableList`: native
 * long-press drag (styled lift + neighbours spring apart), and a web ▲/▼ editing mode toggled from
 * the top bar (the drag library is native-only). Deleting a list also removes it from every entry's
 * memberships (the backend cascades). Mirrors `custom-pages.tsx`.
 */
export default function ManageListsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const { open } = useOverlay();
  const [editing, setEditing] = useState(false);
  const { lists, createList, renameList, reorderLists, deleteList } = useLibraryLists();
  const canReorder = lists.length >= 2;

  const openCreate = () =>
    open(() => (
      <NamePromptForm
        title="New list"
        placeholder="List name"
        submitLabel="Create"
        onSubmit={(name) => {
          void createList(name);
          showToast('List created');
        }}
      />
    ));

  const openRename = (id: string, name: string) =>
    open(() => (
      <NamePromptForm
        title="Rename list"
        placeholder="List name"
        submitLabel="Rename"
        initialValue={name}
        onSubmit={(next) => renameList(id, next)}
      />
    ));

  const confirmDelete = (id: string, name: string) =>
    openConfirm({
      message: `“${name}” will be removed. The series in it stay in your library.`,
      confirmLabel: 'Delete List',
      onConfirm: () => {
        deleteList(id);
        showToast('List deleted');
      },
    });

  const renderRow = (l: LibraryList) => (
    <SwipeableSettingsRow
      label={l.name}
      recycleKey={l.id}
      testID={`manage-lists.row.${l.id}`}
      onPress={() => openRename(l.id, l.name)}
      actions={[
        { label: 'Rename', icon: PencilIcon, onPress: () => openRename(l.id, l.name) },
        { label: 'Delete', icon: TrashIcon, destructive: true, onPress: () => confirmDelete(l.id, l.name) },
      ]}
    />
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Manage Lists"
        onBack={() => router.back()}
        right={
          editing ? (
            <TopBarButton
              testID="manage-lists.done"
              icon={<CheckIcon color={theme.text} size={22} />}
              label="Done reordering"
              onPress={() => setEditing(false)}
            />
          ) : IS_WEB && canReorder ? (
            <TopBarButton
              testID="manage-lists.reorder"
              icon={<GripIcon color={theme.text} size={22} />}
              label="Reorder lists"
              onPress={() => setEditing(true)}
            />
          ) : undefined
        }
      />

      {lists.length === 0 ? (
        <View style={[styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No lists yet. Create one with the + button, then file series into it from a series page or a
            card&apos;s long-press menu.
          </ThemedText>
        </View>
      ) : (
        <ReorderableList
          data={lists}
          keyOf={(l) => l.id}
          renderRow={renderRow}
          label={(l) => l.name}
          onReorder={reorderLists}
          editing={editing}
        />
      )}

      {!editing && (
        <AddFab onPress={openCreate} testID="manage-lists.add" label="New list" right={SettingsGutter} bottom={Spacing.five} />
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
