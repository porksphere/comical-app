import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { PlusIcon } from '@/components/icons/ui-icons';
import { useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { RefreshableSettingsScroll } from '@/components/settings/refreshable-settings-scroll';
import { RetryBlock } from '@/components/retry-block';
import { SettingsSection } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';

export default function RegistriesScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { open } = useOverlay();

  const { data: registries, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.registries(),
    queryFn: ({ signal }) => ds.getRegistries(signal),
  });

  // Refresh each registry's operator label. `getRegistries` (the list) never fetches indexes, so a
  // relabelled registry wouldn't show its new name on its own. Browsing each registry fetches its
  // index, which reconciles the saved `displayName` server-side (see RegistryManager.fetchAndCache);
  // we then re-read the list. Per-registry so it also covers registries with nothing installed.
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

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Registries"
        right={
          // `null` = this server has no registry support at all, so there's nothing to add to.
          registries !== null && (
            <TopBarButton
              icon={<PlusIcon color={theme.text} size={22} />}
              label="Add registry"
              onPress={() => open(() => <AddRegistryForm />)}
            />
          )
        }
      />
      <RefreshableSettingsScroll refresh={reconcileLabels}>
        {isLoading ? (
          <ActivityIndicator />
        ) : error ? (
          <RetryBlock message={friendlyError(error, 'Failed to load registries. Try again.')} onRetry={() => refetch()} />
        ) : registries === null ? (
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              Registries are not available on this server.
            </ThemedText>
          </View>
        ) : registries && registries.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No registries added yet. A registry is a catalog that bridges and trackers are installed from — add one
              with the + above.
            </ThemedText>
          </View>
        ) : (
          <SettingsSection>
            {(registries ?? []).map((r) => (
              <SwipeableSettingsRow
                key={r.url}
                // Operator-set label (e.g. "SFW") shown next to the derived owner/repo name, so one
                // publisher's several registries are distinguishable. Falls back to just the name.
                label={r.displayName ? `${r.displayName} — ${r.name}` : r.name}
                description={r.url}
                onPress={() => router.push({ pathname: '/registry-browse', params: { url: r.url } })}
                actionLabel="Remove"
                onAction={() => open(() => <RemoveRegistryConfirm url={r.url} />)}
              />
            ))}
          </SettingsSection>
        )}
      </RefreshableSettingsScroll>
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
        <Pressable onPress={closeTop} style={styles.confirmBtn}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={() => removeMutation.mutate()} disabled={removeMutation.isPending} style={styles.confirmBtn}>
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
      <Pressable onPress={doAdd} disabled={adding || !url.trim()}>
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
