import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddFab } from '@/components/add-fab';
import { openConfirm } from '@/components/confirm-popup';
import { Holdable } from '@/components/context-menu';
import { CheckIcon, ClearIcon, GripIcon, PencilIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SelectLead, SelectPillBar, SelectToggle, useSelectMode } from '@/components/multi-select/select-mode';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { SettingsGutter, Spacing } from '@/constants/theme';
import { showToast } from '@/components/toast';
import { addPage, deletePage, renamePage, reorderPages, useCustomPages, type CustomPage } from '@/data/custom-pages';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';
import { testId } from '@/lib/test-id';

const IS_WEB = Platform.OS === 'web';

/**
 * The top-level custom-pages editor: a reorderable list of the pages the user has composed for the
 * "Comical" aggregate bridge. Tapping a page opens its section editor (`/custom-page-editor`). Mirrors
 * `registries.tsx` — same TopBar + ReorderableList + SwipeableSettingsRow shape — but the data is the
 * local Legend State store (`custom-pages.ts`), not a server query.
 */
export default function CustomPagesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const insets = useSafeAreaInsets();
  const { open } = useOverlay();
  // Web-only reorder mode (▲/▼). Native reorders in place via long-press drag.
  const [editing, setEditing] = useState(false);

  const pages = useCustomPages();
  const canReorder = pages.length >= 2;

  // ── Multi-select mode (the shared select-mode chrome) — bulk-delete pages ──
  const mode = useSelectMode();
  const selecting = mode.selecting;
  const allKeys = useMemo(() => pages.map((p) => p.id), [pages]);
  const ms = useMultiSelect(allKeys);
  const toggleSelecting = () => {
    if (selecting) ms.clear();
    mode.toggle();
  };
  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;
  const stagingRows = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('custom-pages.menu', 'all'),
    },
  ];
  const deleteSelected = () => {
    const ids = allKeys.filter((id) => ms.selected.has(id));
    for (const id of ids) deletePage(id);
    ms.clear();
    mode.exit();
    showToast(ids.length === 1 ? 'Page deleted' : `${ids.length} pages deleted`);
  };
  const confirmDeleteSelected = () =>
    openConfirm({
      message: `${ms.count === 1 ? 'This page' : `These ${ms.count} pages`} and their sections will be removed. This can't be undone.`,
      confirmLabel: ms.count === 1 ? 'Delete Page' : `Delete ${ms.count} Pages`,
      pendingLabel: 'Deleting…',
      errorFallback: 'Failed to delete pages',
      onConfirm: deleteSelected,
    });

  const renderRow = (p: CustomPage) => (
    // In select mode the row toggles (tap) / range-fills (hold, via the shared Holdable) instead of
    // opening the page, and its swipe action is parked — same pattern as registries.tsx.
    <Holdable
      key={p.id}
      enabled={selecting}
      onHold={() => {
        hapticSelection();
        ms.rangeFill(p.id);
      }}>
      {({ onLongPress }) => (
        <SwipeableSettingsRow
          label={p.name}
          description={`${p.sections.length} ${p.sections.length === 1 ? 'section' : 'sections'}`}
          swipeEnabled={!selecting}
          leading={
            <SelectLead progress={mode.progress} selected={ms.isSelected(p.id)} itemKey={p.id} edgeOffset={SettingsGutter} />
          }
          onPress={
            selecting
              ? () => ms.toggle(p.id)
              : () => router.push({ pathname: '/custom-page-editor', params: { pageId: p.id } })
          }
          onLongPress={selecting ? onLongPress : undefined}
          actions={[
            {
              label: 'Rename',
              icon: PencilIcon,
              onPress: () =>
                open(() => (
                  <NamePromptForm
                    title="Rename page"
                    placeholder="Page name"
                    submitLabel="Rename"
                    initialValue={p.name}
                    onSubmit={(name) => renamePage(p.id, name)}
                  />
                )),
            },
            {
              label: 'Delete',
              icon: TrashIcon,
              destructive: true,
              onPress: () => open(() => <DeletePageConfirm pageId={p.id} name={p.name} />),
            },
          ]}
        />
      )}
    </Holdable>
  );

  const openAddPage = () =>
    open(() => (
      <NamePromptForm
        title="New page"
        placeholder="Page name"
        submitLabel="Create"
        onSubmit={(name) => router.push({ pathname: '/custom-page-editor', params: { pageId: addPage(name) } })}
      />
    ));

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title={selecting ? `${ms.count} selected` : 'Custom Pages'}
        right={
          editing ? (
            <TopBarButton
              testID="custom-pages.done"
              icon={<CheckIcon color={theme.text} size={22} />}
              label="Done reordering"
              onPress={() => setEditing(false)}
            />
          ) : selecting ? (
            <SelectToggle selecting onToggle={toggleSelecting} testID="custom-pages.select-toggle" />
          ) : (
            // The + add button now lives in the floating FAB below (hidden in select mode); the
            // top-right holds the select toggle where the + used to be.
            <View style={styles.topActions}>
              {IS_WEB && canReorder && (
                <TopBarButton
                  testID="custom-pages.reorder"
                  icon={<GripIcon color={theme.text} size={22} />}
                  label="Reorder pages"
                  onPress={() => setEditing(true)}
                />
              )}
              {allKeys.length > 0 && (
                <SelectToggle selecting={false} onToggle={toggleSelecting} testID="custom-pages.select-toggle" />
              )}
            </View>
          )
        }
      />
      {pages.length === 0 ? (
        <View style={[styles.stateHost, styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No custom pages yet. Compose your own — mix any bridge&apos;s lists as rails or grids — and it&apos;ll show
            up in the Comical page selector. Add one with the + button.
          </ThemedText>
        </View>
      ) : (
        <ReorderableList
          data={pages}
          keyOf={(p) => p.id}
          renderRow={renderRow}
          label={(p) => p.name}
          onReorder={reorderPages}
          editing={editing}
          dragEnabled={!selecting}
        />
      )}

      {/* The + add affordance: a floating FAB in normal mode, hidden while selecting. */}
      {!selecting && !editing && (
        <AddFab
          onPress={openAddPage}
          testID="custom-pages.add"
          label="Add page"
          right={SettingsGutter}
          bottom={Math.max(insets.bottom, Spacing.three)}
        />
      )}

      {/* The floating select-mode chrome: staging "…" bottom-left, the Delete verb bottom-right. */}
      {selecting && (
        <SelectPillBar
          left={SettingsGutter}
          right={SettingsGutter}
          bottom={Math.max(insets.bottom, Spacing.three)}
          options={stagingRows}
          optionsTestID="custom-pages.select-options"
          verbs={
            ms.count > 0
              ? [
                  {
                    key: 'delete',
                    label: `Delete ${ms.count} pages`,
                    Icon: TrashIcon,
                    color: theme.danger,
                    onPress: confirmDeleteSelected,
                    testID: 'custom-pages.delete-selected',
                  },
                ]
              : []
          }
        />
      )}
    </ThemedView>
  );
}

function DeletePageConfirm({ pageId, name }: { pageId: string; name: string }) {
  const theme = useTheme();
  const { closeTop } = useOverlay();
  return (
    <View style={styles.confirmBody}>
      <ThemedText type="subtitle">Delete page?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        “{name}” and its sections will be removed. This can&apos;t be undone.
      </ThemedText>
      <View style={styles.confirmActions}>
        <Pressable testID="custom-pages.delete.cancel" onPress={closeTop} style={styles.confirmBtn}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable
          testID="custom-pages.delete.confirm"
          onPress={() => {
            deletePage(pageId);
            closeTop();
          }}
          style={styles.confirmBtn}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            Delete
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * A one-field name prompt overlay, shared by "New page" and (via the editor) "Rename page". Exported
 * so the editor reuses the exact same sheet. `renamePage` isn't used here directly — the caller wires
 * `onSubmit` to whatever it needs.
 */
export function NamePromptForm({
  title,
  placeholder,
  submitLabel,
  initialValue = '',
  onSubmit,
}: {
  title: string;
  placeholder: string;
  submitLabel: string;
  initialValue?: string;
  onSubmit: (name: string) => void;
}) {
  const theme = useTheme();
  const { closeTop } = useOverlay();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [name, setName] = useState(initialValue);
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed);
    closeTop();
  };

  return (
    <View style={styles.confirmBody}>
      <ThemedText type="subtitle">{title}</ThemedText>
      <TextInput
        testID="custom-pages.name-input"
        ref={inputRef}
        value={name}
        onChangeText={setName}
        onFocus={() => keyboardAvoiding.onFocus(inputRef.current)}
        onBlur={keyboardAvoiding.onBlur}
        onSubmitEditing={submit}
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        autoFocus
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      <Pressable testID="custom-pages.name-submit" onPress={submit} disabled={!trimmed}>
        <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }, !trimmed && styles.saveBtnDisabled]}>
          <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
            {submitLabel}
          </ThemedText>
        </ThemedView>
      </Pressable>
    </View>
  );
}

// Re-export so the editor can `renamePage` without importing the store twice at the call site.
export { renamePage };

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stateHost: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.five,
  },
  emptyText: {
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  saveBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  confirmBody: {
    gap: Spacing.three,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
  },
  confirmBtn: {
    paddingVertical: Spacing.two,
  },
});
