/**
 * The checks waiting for the person (`waitingChecks$`): sources whose anti-bot check wanted a person
 * while the app was loading them on its own, behind one row instead of a sheet each. A tap runs them
 * one after another, shown, then reloads what they hold up. Renders nothing while none wait.
 *
 * A bridge's own page passes `bridgeId` and shows only its check. The composite pages show none: each
 * held-up rail says "Waiting on verification" and verifies its own bridge.
 */
import { useSelector } from '@legendapp/state/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ChevronRightIcon, ShieldCheckIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { verifyWaitingChecks } from '@/data/api';
import { canRunWebCheck, waitingChecks$ } from '@/data/web-check';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useTheme } from '@/hooks/use-theme';

export function WebCheckPrompt({ bridgeId }: { bridgeId?: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { nameOf } = useBridgeMap();
  const bridgeIds = useSelector(() => [
    ...new Set(
      Object.values(waitingChecks$.get())
        .map((w) => w.bridgeId)
        .filter((id) => !bridgeId || id === bridgeId),
    ),
  ]);
  const [running, setRunning] = useState(false);
  if (bridgeIds.length === 0 || !canRunWebCheck()) return null;

  const one = bridgeIds.length === 1;
  const title = one ? `${nameOf(bridgeIds[0]!)} is waiting on verification` : `${bridgeIds.length} sources are waiting on verification`;
  const verify = async () => {
    if (running) return;
    setRunning(true);
    try {
      const passed = await verifyWaitingChecks(bridgeId);
      if (passed.length) await queryClient.invalidateQueries({ predicate: (q) => q.queryKey.some((part) => passed.includes(part as string)) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Pressable
      testID="web-check.prompt.verify"
      accessibilityRole="button"
      accessibilityLabel={`${title}. Verify`}
      onPress={() => void verify()}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
      <ShieldCheckIcon color={theme.accent} size={22} />
      <ThemedText type="smallBold" numberOfLines={2} style={styles.text}>
        {title}
      </ThemedText>
      {running ? <ActivityIndicator /> : <ChevronRightIcon color={theme.textSecondary} size={18} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.one,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderRadius: 14,
  },
  text: { flex: 1, minWidth: 0 },
});
