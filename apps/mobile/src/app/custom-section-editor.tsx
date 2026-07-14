import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { SettingsSelectRow, SettingsTextRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { addSection, layoutLabel, updateSection, useCustomPage, type CustomLayout } from '@/data/custom-pages';
import { queryKeys } from '@/data/queries';
import { LIST_LAYOUTS, useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';

// Content-type options, derived from the contract's layout list (LIST_LAYOUTS) — a layout added to the
// contract shows up here automatically. `grid` renders as a vertical grid; everything else as a rail.
const LAYOUT_OPTIONS: readonly CustomLayout[] = LIST_LAYOUTS;
const LAYOUT_SELECT_OPTIONS: SettingsOption<CustomLayout>[] = LAYOUT_OPTIONS.map((l) => ({ value: l, label: layoutLabel(l) }));
const DEFAULT_LAYOUT: CustomLayout = LAYOUT_OPTIONS.includes('carousel') ? 'carousel' : LAYOUT_OPTIONS[0];

/**
 * Add/edit one custom-page section on its own pushed screen, styled with the app's standard settings
 * rows: Bridge / List / Layout `SettingsSelectRow`s and a `SettingsTextRow` for the optional name.
 * There's no save button — the section is committed when you leave the screen (a new section is only
 * created if a bridge and list are set). Params: `pageId` (required) and `sectionId` (when editing).
 */
export default function CustomSectionEditorScreen() {
  const { pageId, sectionId } = useLocalSearchParams<{ pageId?: string; sectionId?: string }>();
  const contentPadding = useSettingsScrollPadding();
  const ds = useDataSource();
  const mock = useMockActive();
  const hideNsfw = useHideNsfw();

  const page = useCustomPage(pageId);
  const section = page?.sections.find((s) => s.id === sectionId);
  const editing = !!section;

  const { byId } = useBridgeMap();
  // Respect the Hide-NSFW setting, like the Browse bridge selector does — NSFW-flagged bridges don't
  // appear as section sources while it's on.
  const bridges = useMemo(() => [...byId.values()].filter((b) => !hideNsfw || !b.nsfw), [byId, hideNsfw]);
  // Reserve the thumbnail slot for every bridge (empty string → the label-initial fallback) so the
  // rows in the picker stay aligned whether or not a given bridge has an icon.
  const bridgeOptions = useMemo<SettingsOption<string>[]>(
    () => bridges.map((b) => ({ value: b.id, label: b.name, thumbnail: b.thumbnail ?? '' })),
    [bridges],
  );

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
  const listOptions = useMemo<SettingsOption<string>[]>(
    () => (lists ?? []).map((l) => ({ value: l.id, label: l.name })),
    [lists],
  );
  // Same "derive, don't effect-sync" for the list: a bridge change resets `listId` to '', which then
  // falls back to that bridge's first list once its lists load.
  const effectiveListId = lists?.some((l) => l.id === listId) ? listId : (lists?.[0]?.id ?? '');

  // Commit on leave (no save button). A ref holds the latest values so the unmount cleanup — which
  // runs once, with no reactive deps — reads what's current rather than what was set at mount. The ref
  // is kept fresh from an effect (updating it during render is disallowed).
  const latest = useRef({ pageId, sectionId: section?.id, bridgeId: '', listId: '', layout, name });
  useEffect(() => {
    latest.current = { pageId, sectionId: section?.id, bridgeId: effectiveBridgeId, listId: effectiveListId, layout, name };
  });
  useEffect(
    () => () => {
      const d = latest.current;
      if (!d.pageId || !d.bridgeId || !d.listId) return; // nothing valid to commit (e.g. a cancelled add)
      const fields = { bridgeId: d.bridgeId, listId: d.listId, layout: d.layout, name: d.name.trim() ? d.name.trim() : null };
      if (d.sectionId) updateSection(d.pageId, d.sectionId, fields);
      else addSection(d.pageId, fields);
    },
    [],
  );

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
        <SettingsSection>
          <SettingsSelectRow
            label="Bridge"
            value={effectiveBridgeId}
            options={bridgeOptions}
            onChange={(id) => {
              setBridgeId(id);
              setListId(''); // reset — the old list won't exist on the new bridge (derived re-picks)
            }}
          />
          {listOptions.length > 0 ? (
            <SettingsSelectRow label="List" value={effectiveListId} options={listOptions} onChange={setListId} />
          ) : (
            <SettingsRow
              label="List"
              right={
                <ThemedText type="small" themeColor="textSecondary">
                  {effectiveBridgeId ? 'Loading…' : '—'}
                </ThemedText>
              }
            />
          )}
          <SettingsSelectRow label="Layout" value={layout} options={LAYOUT_SELECT_OPTIONS} onChange={setLayout} />
          <SettingsTextRow
            label="Name"
            description="Blank inherits the list name"
            value={name}
            onChange={setName}
            placeholder={lists?.find((l) => l.id === effectiveListId)?.name ?? 'List name'}
          />
        </SettingsSection>
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
});
