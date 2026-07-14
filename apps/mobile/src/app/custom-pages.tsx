import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CheckIcon, GripIcon, PlusIcon } from '@/components/icons/ui-icons';
import { useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { addPage, deletePage, renamePage, reorderPages, useCustomPages, type CustomPage } from '@/data/custom-pages';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';

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
  const { open } = useOverlay();
  // Web-only reorder mode (▲/▼). Native reorders in place via long-press drag.
  const [editing, setEditing] = useState(false);

  const pages = useCustomPages();
  const canReorder = pages.length >= 2;

  const renderRow = (p: CustomPage) => (
    <SwipeableSettingsRow
      key={p.id}
      label={p.name}
      description={`${p.sections.length} ${p.sections.length === 1 ? 'section' : 'sections'}`}
      onPress={() => router.push({ pathname: '/custom-page-editor', params: { pageId: p.id } })}
      secondary={{
        label: 'Rename',
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
      }}
      actionLabel="Delete"
      onAction={() => open(() => <DeletePageConfirm pageId={p.id} name={p.name} />)}
    />
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Custom Pages"
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
                  label="Reorder pages"
                  onPress={() => setEditing(true)}
                />
              )}
              <TopBarButton
                icon={<PlusIcon color={theme.text} size={22} />}
                label="Add page"
                onPress={() =>
                  open(() => (
                    <NamePromptForm
                      title="New page"
                      placeholder="Page name"
                      submitLabel="Create"
                      onSubmit={(name) => router.push({ pathname: '/custom-page-editor', params: { pageId: addPage(name) } })}
                    />
                  ))
                }
              />
            </View>
          )
        }
      />
      {pages.length === 0 ? (
        <View style={[styles.stateHost, styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No custom pages yet. Compose your own — mix any bridge&apos;s lists as rails or grids — and it&apos;ll show
            up in the Comical page selector. Add one with the + above.
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
        <Pressable onPress={closeTop} style={styles.confirmBtn}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable
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
      <Pressable onPress={submit} disabled={!trimmed}>
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
