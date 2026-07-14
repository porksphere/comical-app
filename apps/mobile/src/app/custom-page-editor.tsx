import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CheckIcon, GripIcon, PencilIcon, PlusIcon } from '@/components/icons/ui-icons';
import { useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { Selector } from '@/components/selector';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { NamePromptForm } from '@/app/custom-pages';
import {
  addSection,
  deleteSection,
  renamePage,
  reorderSections,
  updateSection,
  useCustomPage,
  type CustomLayout,
  type CustomSection,
} from '@/data/custom-pages';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { BridgeList } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useBridgeListsResolver } from '@/hooks/use-custom-page-rows';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';

const IS_WEB = Platform.OS === 'web';
const LAYOUT_LABELS: Record<CustomLayout, string> = { rail: 'Rail', grid: 'Grid' };

/**
 * Editor for ONE custom page's sections: a reorderable list where each row pins a bridge's list as a
 * rail or grid. Section titles resolve dynamically (a section with no explicit name shows the live
 * bridge-list name — see `useBridgeListsResolver`). Tapping a section opens the picker overlay; the
 * top bar renames the page and adds sections. Same list/row chrome as `custom-pages.tsx` / `registries.tsx`.
 */
export default function CustomPageEditorScreen() {
  const { pageId } = useLocalSearchParams<{ pageId?: string }>();
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

  const renderRow = (s: CustomSection) => (
    <SwipeableSettingsRow
      key={s.id}
      label={titleOf(s)}
      description={`${nameOf(s.bridgeId)} · ${LAYOUT_LABELS[s.layout]}`}
      onPress={() => open(() => <SectionEditor pageId={page.id} section={s} />)}
      actionLabel="Delete"
      onAction={() => deleteSection(page.id, s.id)}
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
                icon={<PencilIcon color={theme.text} size={22} />}
                label="Rename page"
                onPress={() =>
                  open(() => (
                    <NamePromptForm
                      title="Rename page"
                      placeholder="Page name"
                      submitLabel="Rename"
                      initialValue={page.name}
                      onSubmit={(name) => renamePage(page.id, name)}
                    />
                  ))
                }
              />
              <TopBarButton
                icon={<PlusIcon color={theme.text} size={22} />}
                label="Add section"
                onPress={() => open(() => <SectionEditor pageId={page.id} />)}
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

/**
 * The add/edit section sheet: pick a bridge, then one of its lists, then a layout, with an optional
 * name override (blank → the live list name is inherited). Opened over the editor as a stacked
 * overlay; each `Selector` opens its own menu on top of it.
 */
function SectionEditor({ pageId, section }: { pageId: string; section?: CustomSection }) {
  const theme = useTheme();
  const ds = useDataSource();
  const mock = useMockActive();
  const { closeTop } = useOverlay();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const nameInputRef = useRef<TextInput>(null);

  const { byId } = useBridgeMap();
  const bridges = useMemo(() => [...byId.values()], [byId]);
  const bridgeLabels = useMemo(() => Object.fromEntries(bridges.map((b) => [b.id, b.name])), [bridges]);
  const bridgeThumbs = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of bridges) if (b.thumbnail) map[b.id] = b.thumbnail;
    return map;
  }, [bridges]);

  const [bridgeId, setBridgeId] = useState(section?.bridgeId ?? bridges[0]?.id ?? '');
  const [listId, setListId] = useState(section?.listId ?? '');
  const [layout, setLayout] = useState<CustomLayout>(section?.layout ?? 'rail');
  const [name, setName] = useState(section?.name ?? '');

  const { data: lists } = useQuery({
    queryKey: queryKeys.bridgeLists(mock, bridgeId),
    queryFn: ({ signal }) => ds.getBridgeLists(bridgeId, signal),
    enabled: !!bridgeId,
  });

  const listLabels = useMemo(
    () => Object.fromEntries((lists ?? []).map((l: BridgeList) => [l.id, l.name])),
    [lists],
  );
  const listOptions = useMemo(() => (lists ?? []).map((l) => l.id), [lists]);
  // Derive (don't effect-sync) the effective list: a bridge change resets `listId` to '', and until
  // the user picks one it falls back to the bridge's first list once its lists load. Keeping this at
  // render — rather than a setState-in-effect — avoids an extra pass and the lint rule against it.
  const effectiveListId = lists?.some((l) => l.id === listId) ? listId : (lists?.[0]?.id ?? '');

  const canSave = !!bridgeId && !!effectiveListId;
  const save = () => {
    if (!canSave) return;
    const trimmed = name.trim();
    const fields = { bridgeId, listId: effectiveListId, layout, name: trimmed ? trimmed : null };
    if (section) updateSection(pageId, section.id, fields);
    else addSection(pageId, fields);
    closeTop();
  };

  return (
    <View style={styles.editorBody}>
      <ThemedText type="subtitle">{section ? 'Edit section' : 'Add section'}</ThemedText>

      <Field label="Bridge">
        <Selector
          title="Bridge"
          value={bridgeId}
          options={bridges.map((b) => b.id)}
          labels={bridgeLabels}
          thumbnails={bridgeThumbs}
          onChange={(id) => {
            setBridgeId(id);
            setListId(''); // reset — the old list won't exist on the new bridge (effect re-picks)
          }}
          size="small"
        />
      </Field>

      <Field label="List">
        {listOptions.length > 0 ? (
          <Selector title="List" value={effectiveListId} options={listOptions} labels={listLabels} onChange={setListId} size="small" />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {bridgeId ? 'Loading…' : 'Pick a bridge first'}
          </ThemedText>
        )}
      </Field>

      <Field label="Layout">
        <Selector
          title="Layout"
          value={layout}
          options={['rail', 'grid']}
          labels={LAYOUT_LABELS}
          onChange={(v) => setLayout(v as CustomLayout)}
          size="small"
        />
      </Field>

      <View style={styles.nameField}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Name (optional)
        </ThemedText>
        <TextInput
          ref={nameInputRef}
          value={name}
          onChangeText={setName}
          onFocus={() => keyboardAvoiding.onFocus(nameInputRef.current)}
          onBlur={keyboardAvoiding.onBlur}
          placeholder={resolvePlaceholder(lists, effectiveListId)}
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Leave blank to use the list&apos;s own name (updates automatically if the bridge renames it).
        </ThemedText>
      </View>

      <Pressable onPress={save} disabled={!canSave}>
        <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }, !canSave && styles.saveBtnDisabled]}>
          <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
            {section ? 'Save' : 'Add'}
          </ThemedText>
        </ThemedView>
      </Pressable>
    </View>
  );
}

/** The live list name, shown as the name input's placeholder so the user sees what "blank" inherits. */
function resolvePlaceholder(lists: BridgeList[] | undefined, listId: string): string {
  return lists?.find((l) => l.id === listId)?.name ?? 'List name';
}

/** A labeled row wrapping a `Selector`: caption on the left, the picker trigger on the right. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.fieldControl}>{children}</View>
    </View>
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
  editorBody: {
    gap: Spacing.three,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  fieldControl: {
    flexShrink: 1,
  },
  nameField: {
    gap: Spacing.one,
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
    marginTop: Spacing.one,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
});
