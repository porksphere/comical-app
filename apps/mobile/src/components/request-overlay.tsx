import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { expireRecentFailures, useRequestMonitor, useRequestOverlayEnabled, type FailureKind } from '@/data/request-monitor';
import { useTabBarClearance } from '@/lib/tab-bar-clearance';

// A request this old is waiting on something: the source, or our own rate-limiter queue.
const SLOW_MS = 5_000;
const MAX_ROWS = 6;
const AMBER = '#F0A030';
const RED = '#FF6B6B';
const DIM = 'rgba(255,255,255,0.72)';

/** A small read-only corner panel of requests in flight and recent timeouts / holds. Renders
 *  nothing unless Settings → General turns it on. */
export function RequestOverlay() {
  const on = useRequestOverlayEnabled();
  return on ? <Panel /> : null;
}

function Panel() {
  const { inFlight, recent } = useRequestMonitor();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const [now, setNow] = useState(() => Date.now());
  const live = inFlight.length > 0 || recent.length > 0;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      expireRecentFailures();
    }, 500);
    return () => clearInterval(timer);
  }, [live]);

  const slow = inFlight.filter((r) => now - r.startedAt >= SLOW_MS).length;
  const rows = inFlight.slice(0, MAX_ROWS);

  return (
    <View
      pointerEvents="none"
      testID="request-overlay"
      style={[styles.host, { bottom: tabBarClearance + Spacing.three, right: Math.max(insets.right, Spacing.three) }]}>
      <View style={styles.panel}>
        <ThemedText style={[styles.line, styles.head]}>
          {inFlight.length} in flight{slow > 0 ? ` · ${slow} waiting` : ''}
        </ThemedText>
        {rows.map((r) => {
          const age = Math.max(0, now - r.startedAt);
          return (
            <ThemedText key={r.id} style={[styles.line, { color: age >= SLOW_MS ? AMBER : DIM }]} numberOfLines={1}>
              {(age / 1000).toFixed(1).padStart(5)}s  {r.label}
            </ThemedText>
          );
        })}
        {inFlight.length > MAX_ROWS && <ThemedText style={[styles.line, { color: DIM }]}>+{inFlight.length - MAX_ROWS} more</ThemedText>}
        {recent.map((f) => (
          <ThemedText key={f.id} style={[styles.line, { color: failureColor(f.kind) }]} numberOfLines={1}>
            {f.detail}  {f.label}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

function failureColor(kind: FailureKind): string {
  return kind === 'timeout' ? RED : kind === 'held' ? AMBER : DIM;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    maxWidth: 260,
  },
  panel: {
    backgroundColor: 'rgba(20,20,24,0.82)',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  line: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 14,
    color: DIM,
  },
  head: {
    color: '#FFFFFF',
    fontWeight: 700,
  },
});
