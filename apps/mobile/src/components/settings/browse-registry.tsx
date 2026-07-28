import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, View } from 'react-native';

import { MeasuredHeader, OptionList, OverlayHeading, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';
import { testId } from '@/lib/test-id';

/**
 * The "install something new" entry point shared by the Bridges and Trackers screens: bridges and
 * trackers are only ever installed FROM a registry, so adding one means picking which registry to
 * browse. Returns `null` while the registry list is still loading, or if the server has no registry
 * support at all (`getRegistries` → `null`) — the caller hides its "+" in that case, since there
 * would be nothing to browse.
 *
 * With no registries added yet, this sends the user to Registries to add one first; with exactly
 * one, it skips the pointless one-item picker and browses it directly.
 */
export function useBrowseRegistry(): (() => void) | null {
  const ds = useDataSource();
  const router = useRouter();
  const { open } = useOverlay();

  const { data: registries } = useQuery({
    queryKey: queryKeys.registries(),
    queryFn: ({ signal }) => ds.getRegistries(signal),
  });

  if (!registries) return null; // still loading, or this server has no registries

  return () => {
    if (registries.length === 0) {
      router.push('/registries');
      return;
    }
    if (registries.length === 1) {
      router.push({ pathname: '/registry-browse', params: { url: registries[0].url } });
      return;
    }
    open(() => <RegistryPicker />);
  };
}

function RegistryPicker() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const { closeTop } = useOverlay();
  // Already cached by useBrowseRegistry above — this just reads the same key.
  const { data: registries } = useQuery({
    queryKey: queryKeys.registries(),
    queryFn: ({ signal }) => ds.getRegistries(signal),
  });

  return (
    <View style={styles.pickerBody}>
      <MeasuredHeader>
        <OverlayHeading>Browse a registry</OverlayHeading>
      </MeasuredHeader>
      <OptionList>
        {(registries ?? []).map((r) => (
          <Pressable
            key={r.url}
            testID={testId('settings.registry-picker', r.url)}
            onPress={() => {
              hapticSelection();
              closeTop();
              router.push({ pathname: '/registry-browse', params: { url: r.url } });
            }}
            android_ripple={{ color: theme.backgroundSelected }}
            style={styles.pressableCursor}>
            <ThemedView type="backgroundElement" style={styles.pickerRow}>
              <View style={styles.rowText}>
                {/* Operator label (e.g. "SFW") next to the derived name — otherwise two registries
                    from the same repo (same `name`) are indistinguishable here. */}
                <ThemedText type="smallBold">{r.displayName ? `${r.displayName} — ${r.name}` : r.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {r.url}
                </ThemedText>
              </View>
            </ThemedView>
          </Pressable>
        ))}
      </OptionList>
    </View>
  );
}

const styles = StyleSheet.create({
  pickerBody: {
    gap: Spacing.three,
  },
  pressableCursor: {
    cursor: 'pointer',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
