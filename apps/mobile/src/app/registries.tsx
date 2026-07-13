import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlusIcon } from '@/components/icons/ui-icons';
import { useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { RetryBlock } from '@/components/retry-block';
import { SettingsSection } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton, useTopBarInset } from '@/components/top-bar';
import { BarContentGap, BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';

export default function RegistriesScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const theme = useTheme();
  const { open } = useOverlay();

  const { data: registries, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.registries(),
    queryFn: ({ signal }) => ds.getRegistries(signal),
  });

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
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // The TopBar is an absolute overlay, so the content pads past it (and scrolls under its frost).
          { paddingTop: topBarInset + BarContentGap, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
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
          <SettingsSection title="Added" bleed>
            {(registries ?? []).map((r) => (
              <SwipeableSettingsRow
                key={r.url}
                label={r.name}
                description={r.url}
                onPress={() => router.push({ pathname: '/registry-browse', params: { url: r.url } })}
                actionLabel="Remove"
                onAction={() => open(() => <RemoveRegistryConfirm url={r.url} />)}
              />
            ))}
          </SettingsSection>
        )}
      </ScrollView>
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
  content: {
    // Spacing BETWEEN sections (SettingsSection no longer carries a top margin — see settings-row).
    gap: Spacing.five,
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
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
