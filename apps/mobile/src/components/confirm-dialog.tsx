/**
 * A small destructive-action confirmation, presented through the shared overlay (sheet on phones,
 * modal/popover on desktop): title, optional explanation, Cancel + a danger-coloured confirm.
 * Open it with `useOverlay().open(() => <ConfirmDialog … />)` — same shape as the bridges screen's
 * uninstall confirm, extracted so every destructive verb phrases and lays out the same way.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
}: {
  title: string;
  message?: string;
  /** The danger verb, e.g. "Delete". */
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const theme = useTheme();
  const { closeTop } = useOverlay();
  return (
    <View style={styles.body}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {message !== undefined && (
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      )}
      <View style={styles.actions}>
        <Pressable testID="confirm.cancel" onPress={closeTop} style={styles.btn}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable
          testID="confirm.confirm"
          onPress={() => {
            closeTop();
            onConfirm();
          }}
          style={styles.btn}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            {confirmLabel}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
  },
  btn: {
    paddingVertical: Spacing.two,
  },
});
