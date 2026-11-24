import { Snackbar, SnackbarHost, type SnackbarHostRef } from '@expo/ui/jetpack-compose';
import { testID as testTag } from '@expo/ui/jetpack-compose/modifiers';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { MaterialHost } from '@/components/material-host';
import { closeToast, type ToastRequest } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTabBarClearance } from '@/lib/tab-bar-clearance';

// Material's two lengths, in place of the request's own: a snackbar is told only which.
const SHORT_MS = 4000;

/**
 * Android's toast: Material's snackbar, over the tab bar. `ToastHost` keys it by the request, so a
 * newer toast mounts a new host in place of this one: a snackbar host shows its requests one
 * after another, and a replacement would otherwise wait its turn.
 */
export function MaterialToast({ req }: { req: ToastRequest }) {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const host = useRef<SnackbarHostRef>(null);
  const error = req.tone === 'error';
  useEffect(() => {
    let gone = false;
    void host.current
      ?.showSnackbar({ message: req.message, duration: req.durationMs > SHORT_MS ? 'long' : 'short' })
      .then(() => {
        if (!gone) closeToast(req);
      });
    return () => {
      gone = true;
    };
  }, [req]);
  return (
    <View pointerEvents="box-none" style={[styles.place, { bottom: clearance + Spacing.two }]}>
      <MaterialHost matchContents={{ vertical: true }}>
        <SnackbarHost ref={host}>
          <Snackbar
            containerColor={error ? theme.danger : undefined}
            contentColor={error ? theme.dangerOn : undefined}
            modifiers={[testTag(error ? 'toast.error' : 'toast.dismiss')]}
          />
        </SnackbarHost>
      </MaterialHost>
    </View>
  );
}

const styles = StyleSheet.create({
  place: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
  },
});
