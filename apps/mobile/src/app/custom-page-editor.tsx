import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddFab } from '@/components/add-fab';
import { openConfirm } from '@/components/confirm-popup';
import { Holdable } from '@/components/context-menu';
import { CheckIcon, ClearIcon, GripIcon, PencilIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SelectLead, SelectPillBar, SelectToggle, useSelectMode } from '@/components/multi-select/select-mode';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { useOverlay } from '@/components/overlay/overlay';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { SettingsGutter, Spacing } from '@/constants/theme';
import { NamePromptForm } from '@/app/custom-pages';
import {
  deleteSection,
  layoutLabel,
  reorderSections,
  updateSection,
  useCustomPage,
  type CustomSection,
} from '@/data/custom-pages';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useBridgeListsResolver } from '@/hooks/use-custom-page-rows';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';
import { testId } from '@/lib/test-id';

const IS_WEB = Platform.OS === 'web';

/**
 * Editor for ONE custom page's sections: a reorderable list where each row pins a bridge's list as a
 * rail or grid. Section titles resolve dynamically (a section with no explicit name shows the live
 * bridge-list name — see `useBridgeListsResolver`). Tapping a section (or the + button) opens the
 * section editor on its own pushed screen (`/custom-section-editor`); a section is renamed or deleted
 * from its own swipe actions. Same list/row chrome as `custom-pages.tsx` / `registries.tsx`.
 */
export default function CustomPageEditorScreen() {
  const { pageId } = useLocalSearchParams<{ pageId?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const insets = useSafeAreaInsets();
  const { open } = useOverlay();
  const [editing, setEditing] = useState(false);

  const page = useCustomPage(pageId);
  const { nameOf } = useBridgeMap();
  const sections = useMemo(() => page?.sections ?? [], [page]);
  const resolver = useBridgeListsResolver(useMemo(() => sections.map((s) => s.bridgeId), [sections]));

  // ── Multi-select mode (shared select-mode chrome) — bulk-delete sections. These hooks run before
  // the "page missing" guard below so they're unconditional; the handlers that touch `page` are
  // defined after the guard, where it's narrowed non-null. ──
  const mode = useSelectMode();
  const selecting = mode.selecting;
  const allKeys = useMemo(() => sections.map((s) => s.id), [sections]);
  const ms = useMultiSelect(allKeys);

  const titleOf = (s: CustomSection) => s.name ?? resolver.listOf(s.bridgeId, s.listId)?.name ?? nameOf(s.bridgeId);
  const canReorder = sections.length >= 2;

  if (!pageId || !page) {
    return (
      <ThemedView style={styles.container}>
        <TopBar title="Custom Page" />
        <View style={[styles.stateHost, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary">
            This page no longer exists.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const openSection = (sectionId?: string) =>
    router.push({
      pathname: '/custom-section-editor',
      params: sectionId ? { pageId: page.id, sectionId } : { pageId: page.id },
    });

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
      testID: testId('custom-page-editor.menu', 'all'),
    },
  ];
  const deleteSelected = () => {
    const ids = allKeys.filter((id) => ms.selected.has(id));
    for (const id of ids) deleteSection(page.id, id);
    ms.clear();
    mode.exit();
    showToast(ids.length === 1 ? 'Section deleted' : `${ids.length} sections deleted`);
  };
  const confirmDeleteSelected = () =>
    openConfirm({
      message: `${ms.count === 1 ? 'This section' : `These ${ms.count} sections`} will be removed from this page.`,
      confirmLabel: ms.count === 1 ? 'Delete Section' : `Delete ${ms.count} Sections`,
      pendingLabel: 'Deleting…',
      errorFallback: 'Failed to delete sections',
      onConfirm: deleteSelected,
    });

  const renderRow = (s: CustomSection) => (
    // In select mode the row toggles (tap) / range-fills (hold) instead of opening the section, and
    // its swipe action is parked — same pattern as registries.tsx / custom-pages.tsx.
    <Holdable
      key={s.id}
      enabled={selecting}
      onHold={() => {
        hapticSelection();
        ms.rangeFill(s.id);
      }}>
      {({ onLongPress }) => (
        <SwipeableSettingsRow
          label={titleOf(s)}
          description={`${nameOf(s.bridgeId)} · ${layoutLabel(s.layout)}`}
          swipeEnabled={!selecting}
          leading={
            <SelectLead progress={mode.progress} selected={ms.isSelected(s.id)} itemKey={s.id} edgeOffset={SettingsGutter} />
          }
          onPress={selecting ? () => ms.toggle(s.id) : () => openSection(s.id)}
          onLongPress={selecting ? onLongPress : undefined}
          actions={[
            {
              label: 'Rename',
              icon: PencilIcon,
              onPress: () =>
                open(() => (
                  <NamePromptForm
                    title="Rename section"
                    placeholder={titleOf(s)}
                    submitLabel="Rename"
                    initialValue={s.name ?? ''}
                    onSubmit={(name) => updateSection(page.id, s.id, { name })}
                  />
                )),
            },
            { label: 'Delete', icon: TrashIcon, destructive: true, onPress: () => deleteSection(page.id, s.id) },
          ]}
        />
      )}
    </Holdable>
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title={selecting ? `${ms.count} selected` : page.name}
        right={
          editing ? (
            <TopBarButton
              testID="custom-page-editor.done"
              icon={<CheckIcon color={theme.text} size={22} />}
              label="Done reordering"
              onPress={() => setEditing(false)}
            />
          ) : selecting ? (
            <SelectToggle selecting onToggle={toggleSelecting} testID="custom-page-editor.select-toggle" />
          ) : (
            // + add button now lives in the floating FAB below; the top-right holds the select toggle.
            <View style={styles.topActions}>
              {IS_WEB && canReorder && (
                <TopBarButton
                  testID="custom-page-editor.reorder"
                  icon={<GripIcon color={theme.text} size={22} />}
                  label="Reorder sections"
                  onPress={() => setEditing(true)}
                />
              )}
              {allKeys.length > 0 && (
                <SelectToggle selecting={false} onToggle={toggleSelecting} testID="custom-page-editor.select-toggle" />
              )}
            </View>
          )
        }
      />
      {sections.length === 0 ? (
        <View style={[styles.stateHost, styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No sections yet. Add one to pick a bridge&apos;s list and show it as a rail or a grid.
          </ThemedText>
        </View>
      ) : (
        <ReorderableList
          data={sections}
          keyOf={(s) => s.id}
          renderRow={renderRow}
          label={(s) => titleOf(s)}
          onReorder={(ids) => reorderSections(page.id, ids)}
          editing={editing}
          dragEnabled={!selecting}
        />
      )}

      {/* The + add affordance: a floating FAB in normal mode, hidden while selecting. */}
      {!selecting && !editing && (
        <AddFab
          onPress={() => openSection()}
          testID="custom-page-editor.add-section"
          label="Add section"
          right={SettingsGutter}
          bottom={Math.max(insets.bottom, Spacing.three)}
        />
      )}

      {/* Floating select-mode chrome: staging "…" bottom-left, Delete verb bottom-right. */}
      {selecting && (
        <SelectPillBar
          left={SettingsGutter}
          right={SettingsGutter}
          bottom={Math.max(insets.bottom, Spacing.three)}
          options={stagingRows}
          optionsTestID="custom-page-editor.select-options"
          verbs={
            ms.count > 0
              ? [
                  {
                    key: 'delete',
                    label: `Delete ${ms.count} sections`,
                    Icon: TrashIcon,
                    color: theme.danger,
                    onPress: confirmDeleteSelected,
                    testID: 'custom-page-editor.delete-selected',
                  },
                ]
              : []
          }
        />
      )}
    </ThemedView>
  );
}

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
});
