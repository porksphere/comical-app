import { AlertDialog, Column, Text, TextButton } from '@expo/ui/jetpack-compose';
import { testID as testTag } from '@expo/ui/jetpack-compose/modifiers';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { closeConfirm, useConfirmRun, type ConfirmRequest } from '@/components/confirm-popup';
import { MaterialHost } from '@/components/material-host';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

/**
 * Android's confirmation: Material's alert dialog, the verb and Cancel as its two text buttons.
 * The dialog is a window of its own, so its host is a point in the page that draws nothing.
 */
export function MaterialConfirm({ req }: { req: ConfirmRequest }) {
  const theme = useTheme();
  const close = () => closeConfirm(req);
  const { pending, error, confirm } = useConfirmRun(req, close);
  useEffect(hapticImpactLight, []);
  return (
    <MaterialHost style={styles.host}>
      <AlertDialog onDismissRequest={close}>
        {req.title && (
          <AlertDialog.Title>
            <Text>{req.title}</Text>
          </AlertDialog.Title>
        )}
        <AlertDialog.Text>
          <Column verticalArrangement={{ spacedBy: 8 }}>
            <Text>{req.message}</Text>
            {req.detail && <Text color={theme.textSecondary}>{req.detail}</Text>}
            {error && <Text color={theme.danger}>{error}</Text>}
          </Column>
        </AlertDialog.Text>
        <AlertDialog.ConfirmButton>
          <TextButton
            enabled={!pending}
            colors={req.tone === 'primary' ? undefined : { contentColor: theme.danger }}
            modifiers={[testTag('confirm.confirm')]}
            onClick={() => void confirm()}>
            <Text>{pending ? (req.pendingLabel ?? req.confirmLabel) : req.confirmLabel}</Text>
          </TextButton>
        </AlertDialog.ConfirmButton>
        <AlertDialog.DismissButton>
          <TextButton modifiers={[testTag('confirm.cancel')]} onClick={close}>
            <Text>Cancel</Text>
          </TextButton>
        </AlertDialog.DismissButton>
      </AlertDialog>
    </MaterialHost>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 1,
    height: 1,
  },
});
