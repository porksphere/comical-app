import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openConfirm } from '@/components/confirm-popup';
import { Holdable } from '@/components/context-menu';
import { CheckIcon, ClearIcon, GripIcon, PlusIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SelectLead, SelectPillBar, SelectToggle, useSelectMode } from '@/components/multi-select/select-mode';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { RetryBlock } from '@/components/retry-block';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { SettingsGutter, Spacing } from '@/constants/theme';
import type { SavedRegistry } from '@/data/api';
import { applyOrder, setRegistryOrder, useRegistryOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

const IS_WEB = Platform.OS === 'web';

export default function RegistriesScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { open } = useOverlay();
  // Web-only reorder mode (▲/▼). Native reorders in place via long-press drag.
  const [editing, setEditing] = useState(false);

  const { data: registries, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.registries(),
    queryFn: ({ signal }) => ds.getRegistries(signal),
  });

  // Registries are keyed by url; apply the saved order the same way bridges/trackers do.
  const order = useRegistryOrder();
  const ordered = Array.isArray(registries) ? applyOrder(registries, order, (r) => r.url) : registries;
  const canReorder = Array.isArray(ordered) && ordered.length >= 2;

  // Refresh each registry's operator label (the pull-to-refresh handler). `getRegistries` (the list)
  // never fetches indexes, so a relabelled registry wouldn't show its new name on its own. Browsing
  // each registry fetches its index, which reconciles the saved `displayName` server-side (see
  // RegistryManager.fetchAndCache); we then re-read the list. Per-registry so it also covers
  // registries with nothing installed.
  const reconcileLabels = useCallback(async () => {
    const regs = registries ?? [];
    if (regs.length > 0) {
      await Promise.allSettled(regs.map((r) => ds.browseRegistryBridges(r.url)));
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.registries() });
  }, [registries, ds, queryClient]);

  // The nicety: nudge the labels fresh once when the screen first has registries, in the background
  // (no spinner) — so a relabelled registry surfaces without the user pulling to refresh or drilling
  // in. Once per mount (the ref guard), and the server memoizes each index, so re-opens are cheap.
  const nudged = useRef(false);
  useEffect(() => {
    if (nudged.current || !registries || registries.length === 0) return;
    nudged.current = true;
    void reconcileLabels();
  }, [registries, reconcileLabels]);

  // ── Multi-select mode (the shared select-mode chrome) — bulk-remove registries ──
  const mode = useSelectMode();
  const selecting = mode.selecting;
  const allKeys = useMemo(() => (Array.isArray(ordered) ? ordered.map((r) => r.url) : []), [ordered]);
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
      testID: testId('registries.menu', 'all'),
    },
  ];

  const removeSelected = async () => {
    const urls = allKeys.filter((u) => ms.selected.has(u));
    for (const url of urls) await ds.removeRegistry(url);
    // Same narrow invalidate as the single-row remove (see RemoveRegistryConfirm).
    await queryClient.invalidateQueries({ queryKey: queryKeys.registries() });
    ms.clear();
    mode.exit();
    showToast(urls.length === 1 ? 'Registry removed' : `${urls.length} registries removed`);
  };
  const confirmRemoveSelected = () =>
    openConfirm({
      message: `${ms.count === 1 ? 'This registry' : `These ${ms.count} registries`} will be removed. Bridges and trackers already installed keep working, but you won't see updates.`,
      confirmLabel: ms.count === 1 ? 'Remove Registry' : `Remove ${ms.count} Registries`,
      onConfirm: () => void removeSelected(),
    });

  const renderRow = (r: SavedRegistry) => (
    // In select mode the row toggles (tap) / range-fills (hold, via the shared Holdable) instead of
    // opening the registry, and its swipe action is parked. Same pattern as the Downloads screen.
    <Holdable
      key={r.url}
      enabled={selecting}
      onHold={() => {
        hapticSelection();
        ms.rangeFill(r.url);
      }}>
      {({ onLongPress }) => (
        <SwipeableSettingsRow
          // Operator-set label (e.g. "SFW") shown next to the derived owner/repo name, so one publisher's
          // several registries are distinguishable. Falls back to just the name.
          label={r.displayName ? `${r.displayName} — ${r.name}` : r.name}
          description={r.url}
          swipeEnabled={!selecting}
          leading={
            <SelectLead progress={mode.progress} selected={ms.isSelected(r.url)} itemKey={r.url} edgeOffset={SettingsGutter} />
          }
          onPress={
            selecting
              ? () => ms.toggle(r.url)
              : () => router.push({ pathname: '/registry-browse', params: { url: r.url } })
          }
          onLongPress={selecting ? onLongPress : undefined}
          actions={[{ label: 'Remove', icon: TrashIcon, destructive: true, onPress: () => open(() => <RemoveRegistryConfirm url={r.url} />) }]}
        />
      )}
    </Holdable>
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title={selecting ? `${ms.count} selected` : 'Registries'}
        right={
          // `null` = this server has no registry support at all, so there's nothing to add to.
          registries !== null &&
          (editing ? (
            <TopBarButton testID="registries.done" icon={<CheckIcon color={theme.text} size={22} />} label="Done reordering" onPress={() => setEditing(false)} />
          ) : selecting ? (
            <SelectToggle selecting onToggle={toggleSelecting} testID="registries.select-toggle" />
          ) : (
            <View style={styles.topActions}>
              {/* Reorder button only on web (native reorders in place — long-press a row). */}
              {IS_WEB && canReorder && (
                <TopBarButton testID="registries.reorder" icon={<GripIcon color={theme.text} size={22} />} label="Reorder registries" onPress={() => setEditing(true)} />
              )}
              {allKeys.length > 0 && <SelectToggle selecting={false} onToggle={toggleSelecting} testID="registries.select-toggle" />}
              <TopBarButton testID="registries.add" icon={<PlusIcon color={theme.text} size={22} />} label="Add registry" onPress={() => open(() => <AddRegistryForm />)} />
            </View>
          ))
        }
      />
      {error ? (
        <View style={[styles.stateHost, contentPadding]}>
          <RetryBlock message={friendlyError(error, 'Failed to load registries. Try again.')} onRetry={() => refetch()} />
        </View>
      ) : isLoading || ordered === undefined ? (
        <View style={[styles.stateHost, contentPadding]}>
          <ActivityIndicator />
        </View>
      ) : ordered === null ? (
        <View style={[styles.stateHost, styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            Registries are not available on this server.
          </ThemedText>
        </View>
      ) : ordered.length === 0 ? (
        <View style={[styles.stateHost, styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No registries added yet. A registry is a catalog that bridges and trackers are installed from — add one with
            the + above.
          </ThemedText>
        </View>
      ) : (
        <ReorderableList
          data={ordered}
          keyOf={(r) => r.url}
          renderRow={renderRow}
          label={(r) => (r.displayName ? `${r.displayName} — ${r.name}` : r.name)}
          onReorder={(urls) => setRegistryOrder(urls)}
          editing={editing}
          dragEnabled={!selecting}
          refresh={reconcileLabels}
        />
      )}

      {/* The floating select-mode chrome: staging "…" bottom-left, the Remove verb bottom-right. */}
      {selecting && (
        <SelectPillBar
          left={SettingsGutter}
          right={SettingsGutter}
          bottom={Math.max(insets.bottom, Spacing.three)}
          options={stagingRows}
          optionsTestID="registries.select-options"
          verbs={
            ms.count > 0
              ? [
                  {
                    key: 'remove',
                    label: `Remove ${ms.count} registries`,
                    Icon: TrashIcon,
                    color: theme.danger,
                    onPress: confirmRemoveSelected,
                    testID: 'registries.remove-selected',
                  },
                ]
              : []
          }
        />
      )}
    </ThemedView>
  );
}

function RemoveRegistryConfirm({ url }: { url: string }) {
  const ds = useDataSource();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { closeTop } = useOverlay();

  const removeMutation = useMutation({
    mutationFn: () => ds.removeRegistry(url),
    onSuccess: async () => {
      // Narrow invalidate, unlike an uninstall: removing a registry doesn't touch the bridges
      // already installed from it, only where updates would come from.
      await queryClient.invalidateQueries({ queryKey: queryKeys.registries() });
      closeTop();
    },
  });
  const error = removeMutation.isError ? friendlyError(removeMutation.error, 'Failed to remove registry') : null;

  return (
    <View style={styles.confirmBody}>
      <ThemedText type="subtitle">Remove registry?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {url}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Bridges/trackers already installed from it keep working, but you won&apos;t see updates.
      </ThemedText>
      {error && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      )}
      <View style={styles.confirmActions}>
        <Pressable testID="registries.remove.cancel" onPress={closeTop} style={styles.confirmBtn}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable testID="registries.remove.confirm" onPress={() => removeMutation.mutate()} disabled={removeMutation.isPending} style={styles.confirmBtn}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            {removeMutation.isPending ? 'Removing…' : 'Remove'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function AddRegistryForm() {
  const ds = useDataSource();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { closeTop } = useOverlay();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [url, setUrl] = useState('');
  const [requireSignature, setRequireSignature] = useState(false);

  const addMutation = useMutation({
    mutationFn: () => ds.addRegistry(url.trim(), requireSignature),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.registries() });
      closeTop();
    },
  });
  const adding = addMutation.isPending;
  const addError = addMutation.isError ? friendlyError(addMutation.error, 'Failed to add registry') : null;
  const doAdd = () => {
    if (url.trim()) addMutation.mutate();
  };

  return (
    <View style={styles.confirmBody}>
      <ThemedText type="subtitle">Add registry</ThemedText>
      <TextInput
        testID="registries.add.url-input"
        ref={inputRef}
        value={url}
        onChangeText={setUrl}
        onFocus={() => keyboardAvoiding.onFocus(inputRef.current)}
        onBlur={keyboardAvoiding.onBlur}
        placeholder="https://example.com/registry"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      <View style={styles.switchRow}>
        <ThemedText type="small">Require signature</ThemedText>
        <ThemedSwitch value={requireSignature} onValueChange={setRequireSignature} />
      </View>
      {addError && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {addError}
        </ThemedText>
      )}
      <Pressable testID="registries.add.submit" onPress={doAdd} disabled={adding || !url.trim()}>
        <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }, (adding || !url.trim()) && styles.saveBtnDisabled]}>
          <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
            {adding ? 'Adding…' : 'Add'}
          </ThemedText>
        </ThemedView>
      </Pressable>
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
