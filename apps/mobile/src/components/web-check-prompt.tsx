/**
 * The checks waiting for the person (`waitingChecks$`): sources whose anti-bot check wanted a person
 * while the app was loading them on its own, behind one line instead of a sheet each. Check runs them
 * one after another, shown, then reloads what they hold up. Renders nothing while none wait.
 */
import { useSelector } from '@legendapp/state/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { verifyWaitingChecks } from '@/data/api';
import { canRunWebCheck, waitingChecks$ } from '@/data/web-check';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useTheme } from '@/hooks/use-theme';

export function WebCheckPrompt() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { nameOf } = useBridgeMap();
  const bridgeIds = useSelector(() => [...new Set(Object.values(waitingChecks$.get()).map((w) => w.bridgeId))]);
  const [running, setRunning] = useState(false);
  if (bridgeIds.length === 0 || !canRunWebCheck()) return null;

  const label = bridgeIds.length === 1 ? `${nameOf(bridgeIds[0]!)} needs a quick check` : `${bridgeIds.length} sources need a quick check`;
  const check = async () => {
    setRunning(true);
    try {
      const passed = await verifyWaitingChecks();
      if (passed.length) await queryClient.invalidateQueries({ predicate: (q) => q.queryKey.some((part) => passed.includes(part as string)) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" style={styles.label} numberOfLines={2}>
        {label}
      </ThemedText>
      {running ? (
        <ActivityIndicator />
      ) : (
        <Pressable testID="web-check.prompt.check" onPress={() => void check()} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Check
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: 12,
  },
  label: { flex: 1 },
});
