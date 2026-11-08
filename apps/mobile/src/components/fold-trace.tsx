import { useEffect, useRef } from 'react';
import { AppState, Dimensions, StyleSheet, View, type ScaledSize } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { logDiagnostic } from '@/lib/diagnostics';

/**
 * TEMPORARY: a trace of what reaches JS as the iPhone Duo folds or unfolds, in the order and at the
 * time it arrives — the app going inactive and active, the window size JS is told of, the size the
 * root view is laid out at natively, and the safe area. Each burst is timed from its first line.
 * Delete with the investigation.
 */
let burstAt = 0;
let lastAt = 0;
export function foldTrace(what: string) {
  const now = performance.now();
  if (now - lastAt > 1500) burstAt = now;
  lastAt = now;
  logDiagnostic('fold', `+${Math.round(now - burstAt)}ms ${what} (app ${AppState.currentState})`);
}

export function FoldTrace() {
  const insets = useSafeAreaInsets();
  const seen = useRef('');
  useEffect(() => {
    const app = AppState.addEventListener('change', (state) => foldTrace(`app became ${state}`));
    const dims = Dimensions.addEventListener('change', ({ window, screen }: { window: ScaledSize; screen: ScaledSize }) =>
      foldTrace(`JS told window ${Math.round(window.width)}x${Math.round(window.height)}, screen ${Math.round(screen.width)}x${Math.round(screen.height)}${window.width > screen.width + 1 || window.height > screen.height + 1 ? ' (skipped: larger than the screen)' : ''}`),
    );
    return () => {
      app.remove();
      dims.remove();
    };
  }, []);
  useEffect(() => {
    const now = `${insets.top},${insets.right},${insets.bottom},${insets.left}`;
    if (seen.current && seen.current !== now) foldTrace(`safe area ${now} (top,right,bottom,left)`);
    seen.current = now;
  }, [insets.top, insets.right, insets.bottom, insets.left]);
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => foldTrace(`root view laid out at ${Math.round(e.nativeEvent.layout.width)}x${Math.round(e.nativeEvent.layout.height)}`)}
    />
  );
}
