import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Selector } from '@/components/selector';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { addSection, layoutLabel, updateSection, useCustomPage, type CustomLayout } from '@/data/custom-pages';
import { queryKeys } from '@/data/queries';
import { LIST_LAYOUTS, useDataSource, useMockActive } from '@/data/source';
import type { BridgeList } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';

// Content-type options + labels, both derived from the contract's layout list (LIST_LAYOUTS) — a
// layout added to the contract shows up here automatically. `grid` renders as a vertical grid;
// everything else as a rail (see railKindFor).
const LAYOUT_OPTIONS = LIST_LAYOUTS as readonly string[];
const LAYOUT_LABELS: Record<string, string> = Object.fromEntries(LAYOUT_OPTIONS.map((l) => [l, layoutLabel(l)]));
const DEFAULT_LAYOUT: CustomLayout = LAYOUT_OPTIONS.includes('carousel') ? 'carousel' : (LAYOUT_OPTIONS[0] as CustomLayout);

/**
 * Add/edit one custom-page section on its own pushed screen (rather than an overlay), styled with the
 * app's settings rows: a Bridge / List / Layout picker row each (label left, inline `Selector` right),
 * plus an optional name field. Blank name → the live bridge-list name is inherited. Params: `pageId`
 * (required) and `sectionId` (present when editing an existing section).
 */
export default function CustomSectionEditorScreen() {
  const { pageId, sectionId } = useLocalSearchParams<{ pageId?: string; sectionId?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const ds = useDataSource();
  const mock = useMockActive();
  const nameInputRef = useRef<TextInput>(null);

  const page = useCustomPage(pageId);
  const section = page?.sections.find((s) => s.id === sectionId);
  const editing = !!section;

  const { byId } = useBridgeMap();
  const bridges = useMemo(() => [...byId.values()], [byId]);
  const bridgeLabels = useMemo(() => Object.fromEntries(bridges.map((b) => [b.id, b.name])), [bridges]);
  const bridgeThumbs = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of bridges) if (b.thumbnail) map[b.id] = b.thumbnail;
    return map;
  }, [bridges]);

  const [bridgeId, setBridgeId] = useState(section?.bridgeId ?? '');
  const [listId, setListId] = useState(section?.listId ?? '');
  // Normalise a legacy/absent layout (the old 'rail' value, or a new section) to a valid content type.
  const [layout, setLayout] = useState<CustomLayout>(
    section && LAYOUT_OPTIONS.includes(section.layout) ? section.layout : DEFAULT_LAYOUT,
  );
  const [name, setName] = useState(section?.name ?? '');

  // Derive (don't effect-sync) the effective bridge: for a NEW section the state starts '' and falls
  // back to the first installed bridge once the list loads; editing starts from the saved bridge.
  const effectiveBridgeId = bridgeId || bridges[0]?.id || '';

  const { data: lists } = useQuery({
    queryKey: queryKeys.bridgeLists(mock, effectiveBridgeId),
    queryFn: ({ signal }) => ds.getBridgeLists(effectiveBridgeId, signal),
    enabled: !!effectiveBridgeId,
  });
  const listLabels = useMemo(
    () => Object.fromEntries((lists ?? []).map((l: BridgeList) => [l.id, l.name])),
    [lists],
  );
  const listOptions = useMemo(() => (lists ?? []).map((l) => l.id), [lists]);
  // Same "derive, don't effect-sync" for the list: a bridge change resets `listId` to '', which then
  // falls back to that bridge's first list once its lists load.
  const effectiveListId = lists?.some((l) => l.id === listId) ? listId : (lists?.[0]?.id ?? '');

  const canSave = !!effectiveBridgeId && !!effectiveListId;
  const save = () => {
    if (!canSave || !pageId) return;
    const trimmed = name.trim();
    const fields = { bridgeId: effectiveBridgeId, listId: effectiveListId, layout, name: trimmed ? trimmed : null };
    if (section) updateSection(pageId, section.id, fields);
    else addSection(pageId, fields);
    router.back();
  };

  if (!pageId || !page) {
    return (
      <ThemedView style={styles.container}>
        <TopBar title="Section" />
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary">
            This page no longer exists.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <TopBar title={editing ? 'Edit section' : 'Add section'} />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        <SettingsSection title="Section">
          <SettingsRow
            label="Bridge"
            right={
              <Selector
                title="Bridge"
                value={effectiveBridgeId}
                options={bridges.map((b) => b.id)}
                labels={bridgeLabels}
                thumbnails={bridgeThumbs}
                onChange={(id) => {
                  setBridgeId(id);
                  setListId(''); // reset — the old list won't exist on the new bridge (derived re-picks)
                }}
                size="small"
              />
            }
          />
          <SettingsRow
            label="List"
            right={
              listOptions.length > 0 ? (
                <Selector title="List" value={effectiveListId} options={listOptions} labels={listLabels} onChange={setListId} size="small" />
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  {effectiveBridgeId ? 'Loading…' : '—'}
                </ThemedText>
              )
            }
          />
          <SettingsRow
            label="Layout"
            right={
              <Selector
                title="Layout"
                value={layout}
                options={LAYOUT_OPTIONS as string[]}
                labels={LAYOUT_LABELS}
                onChange={(v) => setLayout(v as CustomLayout)}
                size="small"
              />
            }
          />
        </SettingsSection>

        <View style={styles.nameField}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.nameHeader}>
            Name (optional)
          </ThemedText>
          <TextInput
            ref={nameInputRef}
            value={name}
            onChangeText={setName}
            placeholder={lists?.find((l) => l.id === effectiveListId)?.name ?? 'List name'}
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
              {editing ? 'Save' : 'Add section'}
            </ThemedText>
          </ThemedView>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameField: {
    gap: Spacing.two,
  },
  nameHeader: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
});
