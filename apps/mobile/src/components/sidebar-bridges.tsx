/**
 * The Bridges group for the sidebar.
 *
 * A bridge is a SCOPE, not a destination: picking one changes what Browse means rather than
 * navigating somewhere new. So selecting here moves the shared Browse selection (`setBridge`, the
 * same observable Browse's own dropdown writes) and then goes to Browse, because a scope change you
 * can't see is indistinguishable from nothing happening.
 *
 * The list comes from `useSelectedBridge()` — the SAME hook the dropdown uses — so the rail and the
 * dropdown cannot disagree about what exists, what order it is in, or which one is current. An
 * earlier draft ran its own `useQuery` on the bridges key to avoid that hook, and got a list missing
 * the synthetic `Comical` aggregate: you could leave the aggregate home from the rail but never
 * return to it, since the aggregate is prepended during resolution and is not in the raw query.
 *
 * `use$` is never called directly in this component — see `useSelectedBridgeId`. Reading an
 * observable inline here (before `useQuery`) is what crashed the whole app while this was being
 * written: the React Compiler doesn't recognise `use$` as a hook, so it treats it as a plain call
 * and its hook-slot accounting drifts. Every observable read below arrives through a `use`-prefixed
 * wrapper for that reason, this file's own collapse state included.
 */
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { SidebarSubItem } from '@/components/app-sidebar';
import { BridgeThumbSize } from '@/components/selector';
import { COMICAL_ICON, isComicalBridge, useSelectedBridge } from '@/data/selected-bridge';
import { router } from '@/lib/nav';

/** Device-local, and persisted: a group collapsed to keep the five destinations above the fold must
 *  stay collapsed across launches, or it re-expands and buries them again. */
export function SidebarBridges({ onNavigate }: { onNavigate?: () => void }) {
  // `bridgeId`, not `bridge`: the raw id is null until the user has picked one, while Browse is
  // already showing the aggregate it resolves to. Highlighting the raw id leaves a fresh install
  // with a rail where nothing is current and the page plainly is.
  const { visibleBridges, bridgeId, setBridge } = useSelectedBridge();

  // `visibleBridges` always carries the aggregate, so it is never empty — but a heading over an
  // empty list is worse than no heading, and this keeps that true if that ever changes.
  if (visibleBridges.length === 0) return null;

  return (
    <>
      {visibleBridges.map((b) => (
        <SidebarSubItem
          key={b.id}
          testID={`sidebar.bridge.${b.id}`}
          label={b.name}
          active={b.id === bridgeId}
          thumbnail={
            isComicalBridge(b.id) ? (
              <Image source={COMICAL_ICON} style={styles.thumb} contentFit="cover" />
            ) : b.thumbnail ? (
              <Image source={{ uri: b.thumbnail }} style={styles.thumb} contentFit="cover" />
            ) : undefined
          }
          onPress={() => {
            setBridge(b.id);
            router.navigate('/');
            onNavigate?.();
          }}
        />
      ))}
    </>
  );
}

/** Matches the Browse top bar's thumbnail corner (8 on a 28pt box) by RATIO, not by copying the
 *  pixel value: this thumb is 18pt, where an 8 would read as a lozenge rather than the same shape. */
const THUMB_SIZE = 18;
const THUMB_RADIUS = Math.round(THUMB_SIZE * (8 / BridgeThumbSize));

const styles = StyleSheet.create({
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_RADIUS },
});
