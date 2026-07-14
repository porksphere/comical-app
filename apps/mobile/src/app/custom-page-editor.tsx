import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { CheckIcon, GripIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/icons/ui-icons';
import { useOverlay } from '@/components/overlay/overlay';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
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
  const { open } = useOverlay();
  const [editing, setEditing] = useState(false);

  const page = useCustomPage(pageId);
  const { nameOf } = useBridgeMap();
  const sections = useMemo(() => page?.sections ?? [], [page]);
  const resolver = useBridgeListsResolver(useMemo(() => sections.map((s) => s.bridgeId), [sections]));

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

  const renderRow = (s: CustomSection) => (
    <SwipeableSettingsRow
      key={s.id}
      label={titleOf(s)}
      description={`${nameOf(s.bridgeId)} · ${layoutLabel(s.layout)}`}
      onPress={() => openSection(s.id)}
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
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title={page.name}
        right={
          editing ? (
            <TopBarButton
              icon={<CheckIcon color={theme.text} size={22} />}
              label="Done reordering"
              onPress={() => setEditing(false)}
            />
          ) : (
            <View style={styles.topActions}>
              {IS_WEB && canReorder && (
                <TopBarButton
                  icon={<GripIcon color={theme.text} size={22} />}
                  label="Reorder sections"
                  onPress={() => setEditing(true)}
                />
              )}
              <TopBarButton
                icon={<PlusIcon color={theme.text} size={22} />}
                label="Add section"
                onPress={() => openSection()}
              />
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
