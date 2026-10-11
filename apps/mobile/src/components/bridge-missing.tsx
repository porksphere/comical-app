import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { bumpDataEpoch } from '@/data/data-epoch';
import { useDataSource } from '@/data/source';
import type { Bridge } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';

/**
 * What a series from an uninstalled bridge says in place of that bridge's errors — which, from a
 * bridge that isn't there, are a server's file paths and a Retry that can never work. Offers the
 * reinstall where the host remembers the registry it came from.
 */
export function BridgeMissingNotice({
  bridge,
  message,
  plate,
  testID,
}: {
  bridge: Bridge;
  message: string;
  /** Drawn on its own surface — on the details page, where it sits among the series' content. */
  plate?: boolean;
  testID: string;
}) {
  const theme = useTheme();
  const ds = useDataSource();
  const queryClient = useQueryClient();
  const { registryUrl } = bridge;
  const reinstall = useMutation({
    mutationFn: async () => {
      await ds.installRegistryBridge(registryUrl ?? '', bridge.id);
      bumpDataEpoch();
      // Everything that failed for want of the bridge — this page's own list and pages included.
      await queryClient.invalidateQueries();
    },
  });

  const body = (
    <>
      <ThemedText type="small" themeColor="textSecondary" style={!plate && styles.centered}>
        {message}
      </ThemedText>
      {registryUrl ? (
        <Pressable
          testID={`${testID}.reinstall`}
          onPress={() => reinstall.mutate()}
          disabled={reinstall.isPending}
          hitSlop={8}
          accessibilityRole="button">
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {reinstall.isPending ? 'Reinstalling…' : `Reinstall ${bridge.name}`}
          </ThemedText>
        </Pressable>
      ) : null}
      {reinstall.isError ? (
        <ThemedText type="small" themeColor="danger" style={!plate && styles.centered}>
          {friendlyError(reinstall.error, "Couldn't reinstall it. Try again from Bridges.")}
        </ThemedText>
      ) : null}
    </>
  );

  return plate ? (
    <ThemedView testID={testID} type="backgroundElement" style={styles.plate}>
      {body}
    </ThemedView>
  ) : (
    <View testID={testID} style={styles.block}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    ...ContinuousCorner,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  block: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
});
