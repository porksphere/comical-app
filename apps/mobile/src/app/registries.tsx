import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { RetryBlock } from '@/components/retry-block';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';

export default function RegistriesScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { open } = useOverlay();

  const { data: registries, error, isLoading, refetch } = useQuery({
    queryKey: ['registries'],
    queryFn: ({ signal }) => ds.getRegistries(signal),
  });

  const removeRegistry = (url: string) => {
    open(() => <RemoveRegistryConfirm url={url} />);
  };

  function RemoveRegistryConfirm({ url }: { url: string }) {
    const { closeTop } = useOverlay();
    const removeMutation = useMutation({
      mutationFn: () => ds.removeRegistry(url),
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ['registries'] });
        closeTop();
      },
    });
    const removing = removeMutation.isPending;
    const doRemove = () => removeMutation.mutate();
    return (
      <View style={styles.confirmBody}>
        <ThemedText type="subtitle">Remove registry?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {url}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Bridges/trackers already installed from it keep working, but you won&apos;t see updates.
        </ThemedText>
        <View style={styles.confirmActions}>
          <Pressable onPress={closeTop} style={styles.confirmBtn}>
            <ThemedText type="smallBold">Cancel</ThemedText>
          </Pressable>
          <Pressable onPress={doRemove} disabled={removing} style={styles.confirmBtn}>
            <ThemedText type="smallBold" style={{ color: theme.danger }}>
              {removing ? 'Removing…' : 'Remove'}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  function AddRegistryForm() {
    const { closeTop } = useOverlay();
    const keyboardAvoiding = useKeyboardAvoidingInput();
    const inputRef = useRef<TextInput>(null);
    const [url, setUrl] = useState('');
    const [requireSignature, setRequireSignature] = useState(false);
    const addMutation = useMutation({
      mutationFn: () => ds.addRegistry(url.trim(), requireSignature),
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ['registries'] });
        closeTop();
      },
    });
    const adding = addMutation.isPending;
    const addError = addMutation.isError ? (addMutation.error as Error).message || 'Failed to add registry' : null;
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

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Registries" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        {isLoading ? (
          <ActivityIndicator />
        ) : error ? (
          <RetryBlock message={(error as Error).message || 'Failed to load registries'} onRetry={() => refetch()} />
        ) : (
          <SettingsSection title="Registries">
            {registries === null ? (
              <ThemedText type="small" themeColor="textSecondary">
                Registries are not available on this server.
              </ThemedText>
            ) : registries && registries.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No registries added yet.
              </ThemedText>
            ) : (
              registries?.map((r) => (
                <SettingsRow
                  key={r.url}
                  label={r.name}
                  description={r.url}
                  onPress={() => router.push({ pathname: '/registry-browse', params: { url: r.url } })}
                  right={
                    <Pressable onPress={() => removeRegistry(r.url)} hitSlop={8}>
                      <ThemedText type="small" style={{ color: theme.danger }}>
                        Remove
                      </ThemedText>
                    </Pressable>
                  }
                />
              ))
            )}
          </SettingsSection>
        )}
        {registries !== null && (
          <Pressable onPress={() => open(() => <AddRegistryForm />)}>
            <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }]}>
              <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
                Add registry
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
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
