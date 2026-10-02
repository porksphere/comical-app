import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
import { BarContentGap, MaxContentWidth, Spacing } from '@/constants/theme';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useHydrated } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { desktopShell } from '@/lib/desktop-shell';
import {useLocalSearchParams, useRouter} from '@/lib/nav';

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
//
// The desktop app is web too, but it IS the app the link is for (it handles `comical://` itself),
// so it takes the native path. Handing off from there would launch itself, land here again, and
// hand off again.
const handsOff = () => Platform.OS === 'web' && !desktopShell();

export default function AddRegistryScreen() {
  const { url } = useLocalSearchParams<{ url?: string }>();
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const queryClient = useQueryClient();
  // Gated on hydration: the static render has no shell, so the desktop would mismatch it.
  const handoff = !useHydrated() ? Platform.OS === 'web' : handsOff();

  const deepLink = url ? `comical://add-registry?url=${encodeURIComponent(url)}` : null;

  const addMutation = useMutation({
    mutationFn: () => ds.addRegistry(url!, false),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.registries() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.registryUpdateCount() });
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
    if (handsOff() && deepLink && typeof window !== 'undefined') window.location.href = deepLink;
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
        ) : handoff ? (
          <>
            <ThemedText type="subtitle">Open in the Comical app</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {url}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              This registry is added from inside the app, not the web preview. If nothing happens
              below, you may not have Comical installed yet.
            </ThemedText>
            <Pressable testID="add-registry.open-in-app" onPress={openInApp}>
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
              <Pressable testID="add-registry.cancel" onPress={cancel} disabled={adding} style={styles.actionBtn}>
                <ThemedText type="smallBold">Cancel</ThemedText>
              </Pressable>
              <Pressable testID="add-registry.confirm" onPress={add} disabled={adding}>
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
