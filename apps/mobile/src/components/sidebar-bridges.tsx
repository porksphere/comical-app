/**
 * The Bridges group for the sidebar — NOT WIRED UP. See the blocker below before reaching for it.
 *
 * A bridge is a SCOPE, not a destination: picking one changes what Browse means rather than
 * navigating somewhere new. So selecting here would move the shared Browse selection
 * (`setSelectedBridge`, the same observable Browse's own dropdown writes) and then go to Browse,
 * because a scope change you can't see is indistinguishable from nothing happening.
 *
 * ── BLOCKER ──────────────────────────────────────────────────────────────────────────────────
 * Rendering this inside `AppSidebar` crashes the whole app: "Cannot read properties of undefined
 * (reading 'length')" thrown from React's hook dispatcher, surfacing at whichever hook happens to
 * run first (it moved between `useRouter`, `use$` and `useEffect` as the hook order was shuffled) —
 * the signature of a corrupted dispatcher rather than a bug in any one hook.
 *
 * Ruled out, each by a separate build: `useRouter` (swapped for the `router` singleton),
 * `useSelectedBridge`/`useHideNsfw` (replaced with a bare `useQuery` on the same key), the
 * `persisted$` collapse store (replaced with `useState`), and mount timing (deferring a tick past
 * the post-hydration commit changed nothing).
 *
 * The live hypothesis: `useActivityBadgeCount` uses the SAME hooks (`useDataSource`,
 * `useMockActive`, `useQuery`, `useEffect`) and renders fine in this sidebar — but it does so
 * inside a `TabTrigger asChild` clone, whereas this is a plain sibling of the triggers under
 * `<Tabs>`. `expo-router/ui`'s `Tabs` already has documented child-discovery behaviour (see
 * TAB_REGISTRATION in app-tabs.tsx). Next test: render this OUTSIDE `<Tabs>` — which means
 * splitting the rail so the trigger rows stay inside and everything else moves out.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { useState } from 'react';
import { use$ } from '@legendapp/state/react';

import { useQuery } from '@tanstack/react-query';

import { SidebarSection, SidebarSubItem } from '@/components/app-sidebar';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import {
  COMICAL_ICON,
  isComicalBridge,
  selectedBridge$,
  setSelectedBridge,
} from '@/data/selected-bridge';
import { router } from '@/lib/nav';
import { Spacing } from '@/constants/theme';


export function SidebarBridges({ onNavigate }: { onNavigate?: () => void }) {
  // Local, not `persisted$`, only because the persisted variant was one of the ruled-out
  // suspects above; restore persistence once the crash is understood.
  const [open, setOpen] = useState(true);
  const selected = use$(selectedBridge$);
  const mock = useMockActive();
  const ds = useDataSource();
  // The SAME query key Browse's own selector reads, so this is a second subscriber to one cache
  // entry rather than a second fetch. Deliberately NOT `useSelectedBridge()`: that hook layers
  // NSFW filtering and saved ordering on top, and its `useHideNsfw` is where this subtree crashed.
  const { data: bridges } = useQuery({
    queryKey: queryKeys.bridges(mock),
    queryFn: ({ signal }) => ds.getBridges(signal),
  });

  // Nothing installed yet — an empty "BRIDGES" heading is worse than no heading.
  if (!bridges || bridges.length === 0) return null;

  return (
    <SidebarSection label="Bridges" open={open} onToggle={() => setOpen(!open)}>
      {bridges.map((b) => {
        const thumb = b.thumbnail;
        return (
          <SidebarSubItem
            key={b.id}
            testID={`sidebar.bridge.${b.id}`}
            label={b.name}
            active={selected === b.id}
            thumbnail={
              isComicalBridge(b.id) ? (
                <Image source={COMICAL_ICON} style={styles.thumb} contentFit="cover" />
              ) : thumb ? (
                <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
              ) : undefined
            }
            onPress={() => {
              setSelectedBridge(b.id);
              router.navigate('/');
              onNavigate?.();
            }}
          />
        );
      })}
    </SidebarSection>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 18, height: 18, borderRadius: Spacing.half },
});
