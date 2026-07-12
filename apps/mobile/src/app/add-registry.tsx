import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
import { BarContentGap, MaxContentWidth, Spacing } from '@/constants/theme';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';

// Deep-link entry point: comical://add-registry?url=<registry index.json URL>
// (also reachable via a Universal/App Link once one is wired up on a verified
// domain — see the "one-click install" investigation on the todo list).
// Lets an external page (e.g. a bridge/tracker repo's README) send users
// straight into a confirm-and-add flow instead of the manual paste-a-URL form
// in registries.tsx.
//
// GitHub's markdown sanitizer strips custom URI schemes from rendered links
// (a bare `comical://...` markdown link renders as unlinked plain text), so
// READMEs must point at this screen's *web* build — the already-public
// https://porksphere.github.io/comical-app/add-registry?url=... — instead of
// the scheme directly. On web this screen just hands off into the native
// scheme (a real click, not an auto-redirect, since browsers largely require
// a user gesture to honor a custom-scheme navigation); the native app then
// re-enters this same screen for the actual confirm-and-add flow below.
export default function AddRegistryScreen() {
  const { url } = useLocalSearchParams<{ url?: string }>();
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const queryClient = useQueryClient();

  const deepLink = url ? `comical://add-registry?url=${encodeURIComponent(url)}` : null;

  const addMutation = useMutation({
    mutationFn: () => ds.addRegistry(url!, false),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.registries() });
      router.replace({ pathname: '/registry-browse', params: { url: url! } });
    },
  });
  const adding = addMutation.isPending;

  const openInApp = () => {
    if (deepLink && typeof window !== 'undefined') window.location.href = deepLink;
  };

  // Best-effort auto-handoff on page load; the visible button below is the
  // reliable path if the browser declines to honor a scripted redirect.
  useEffect(() => {
    if (Platform.OS === 'web' && deepLink && typeof window !== 'undefined') window.location.href = deepLink;
  }, [deepLink]);

  const cancel = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const add = () => {
    if (url) addMutation.mutate();
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Add registry" />
      <View style={[styles.content, { paddingTop: topBarInset + BarContentGap, paddingBottom: insets.bottom + Spacing.five }]}>
        {!url ? (
          <ThemedText type="small" themeColor="textSecondary">
            No registry URL was provided with this link.
          </ThemedText>
        ) : Platform.OS === 'web' ? (
          <>
            <ThemedText type="subtitle">Open in the Comical app</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {url}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              This registry is added from inside the app, not the web preview. If nothing happens
              below, you may not have Comical installed yet.
            </ThemedText>
            <Pressable onPress={openInApp}>
              <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }]}>
                <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
                  Open in Comical app
                </ThemedText>
              </ThemedView>
            </Pressable>
          </>
        ) : (
          <>
            <ThemedText type="subtitle">Add this registry?</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {url}
            </ThemedText>
            {addMutation.isError && (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {(addMutation.error as Error).message || 'Failed to add registry'}
              </ThemedText>
            )}
            <View style={styles.actions}>
              <Pressable onPress={cancel} disabled={adding} style={styles.actionBtn}>
                <ThemedText type="smallBold">Cancel</ThemedText>
              </Pressable>
              <Pressable onPress={add} disabled={adding}>
                <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }, adding && styles.saveBtnDisabled]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
                    {adding ? 'Adding…' : 'Add registry'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.five,
    marginTop: Spacing.two,
  },
  actionBtn: {
    paddingVertical: Spacing.three,
  },
  saveBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
});
