import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AddFab } from '@/components/add-fab';
import { openConfirm } from '@/components/confirm-popup';
import { NamePromptForm } from '@/app/custom-pages';
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, TrashIcon } from '@/components/icons/ui-icons';
import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { showToast } from '@/components/toast';
import { SettingsGutter, Spacing } from '@/constants/theme';
import { useLibraryLists } from '@/hooks/use-library-lists';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';

/**
 * The custom-lists manager, pushed from the Library tab's list selector ("Manage lists…"). Create,
 * rename, reorder (▲/▼), and delete lists. Reorder is optimistic (see `useLibraryLists`) so rows
 * move under the arrow taps. Deleting a list also removes it from every entry's memberships (the
 * backend cascades). Reuses `NamePromptForm` (the shared one-field overlay) for create + rename.
 */
export default function ManageListsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const { open } = useOverlay();
  const { lists, createList, renameList, reorderLists, deleteList } = useLibraryLists();

  const move = (index: number, delta: number) => {
    const next = [...lists];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorderLists(next.map((l) => l.id));
  };

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

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Manage Lists" onBack={() => router.back()} />

      {lists.length === 0 ? (
        <View style={[styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No lists yet. Create one with the + button, then file series into it from a series page or a
            card&apos;s long-press menu.
          </ThemedText>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, contentPadding]}>
          {lists.map((l, i) => (
            <ThemedView key={l.id} type="backgroundElement" style={styles.row} testID={`manage-lists.row.${l.id}`}>
              <View style={styles.reorder}>
                <Pressable
                  testID={`manage-lists.up.${l.id}`}
                  onPress={() => move(i, -1)}
                  disabled={i === 0}
                  hitSlop={6}
                  style={i === 0 && styles.disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Move up">
                  <ArrowUpIcon color={theme.text} size={18} />
                </Pressable>
                <Pressable
                  testID={`manage-lists.down.${l.id}`}
                  onPress={() => move(i, 1)}
                  disabled={i === lists.length - 1}
                  hitSlop={6}
                  style={i === lists.length - 1 && styles.disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Move down">
                  <ArrowDownIcon color={theme.text} size={18} />
                </Pressable>
              </View>

              <Pressable style={styles.nameHit} onPress={() => openRename(l.id, l.name)} accessibilityRole="button">
                <ThemedText numberOfLines={1}>{l.name}</ThemedText>
              </Pressable>

              <Pressable
                testID={`manage-lists.rename.${l.id}`}
                onPress={() => openRename(l.id, l.name)}
                hitSlop={6}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel="Rename list">
                <PencilIcon color={theme.textSecondary} size={18} />
              </Pressable>
              <Pressable
                testID={`manage-lists.delete.${l.id}`}
                onPress={() => confirmDelete(l.id, l.name)}
                hitSlop={6}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel="Delete list">
                <TrashIcon color={theme.danger} size={18} />
              </Pressable>
            </ThemedView>
          ))}
        </ScrollView>
      )}

      <AddFab onPress={openCreate} testID="manage-lists.add" label="New list" right={SettingsGutter} bottom={Spacing.five} />
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
  list: {
    paddingHorizontal: SettingsGutter,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    minHeight: 56,
  },
  reorder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  disabled: {
    opacity: 0.3,
  },
  nameHit: {
    flex: 1,
    paddingVertical: Spacing.two,
  },
  action: {
    padding: Spacing.two,
  },
});
