import { Box, Snackbar, SnackbarHost, type SnackbarHostRef } from '@expo/ui/jetpack-compose';
import { fillMaxSize, testID as testTag } from '@expo/ui/jetpack-compose/modifiers';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { MaterialHost } from '@/components/material-host';
import { closeToast, type ToastRequest } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTabBarClearance } from '@/lib/tab-bar-clearance';

// Material's two lengths, in place of the request's own: a snackbar is told only which.
const SHORT_MS = 4000;
// Room for a message of several lines. The host is given it outright: sized to its content it
// has no height until a snackbar is in it, and the snackbar is never seen.
const ROOM = 160;
const READY_RETRY_MS = 50;
const READY_TRIES = 40;

/**
 * Android's toast: Material's snackbar, over the tab bar, and not touched: it leaves by itself, and
 * what is under its room stays reachable. `ToastHost` keys it by the request, so a
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
    let retry: ReturnType<typeof setTimeout> | undefined;
    // The host takes the call only once Compose has composed it, a frame or more after this
    // effect; until then the call is refused, and asked again.
    const show = (tries: number) => {
      const shown = host.current?.showSnackbar({
        message: req.message,
        duration: req.durationMs > SHORT_MS ? 'long' : 'short',
      });
      const again = () => {
        if (gone) return;
        if (tries > 0) retry = setTimeout(() => show(tries - 1), READY_RETRY_MS);
        else closeToast(req);
      };
      if (!shown) return again();
      shown.then(() => {
        if (!gone) closeToast(req);
      }, again);
    };
    show(READY_TRIES);
    return () => {
      gone = true;
      clearTimeout(retry);
    };
  }, [req]);
  return (
    <View pointerEvents="none" style={[styles.place, { bottom: clearance + Spacing.two }]}>
      <MaterialHost style={StyleSheet.absoluteFill} pointerEvents="none">
        <Box contentAlignment="bottomCenter" modifiers={[fillMaxSize()]}>
          <SnackbarHost ref={host}>
            <Snackbar
              containerColor={error ? theme.danger : undefined}
              contentColor={error ? theme.dangerOn : undefined}
              modifiers={[testTag(error ? 'toast.error' : 'toast.dismiss')]}
            />
          </SnackbarHost>
        </Box>
      </MaterialHost>
    </View>
  );
}

const styles = StyleSheet.create({
  place: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    height: ROOM,
  },
});
