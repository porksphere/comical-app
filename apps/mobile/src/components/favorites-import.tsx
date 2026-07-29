/**
 * The "Import favorites" CONFIRMATION — a floating frosted card listing every series a bridge has
 * favorited on the user's account, each with a checkbox, so nothing lands in the library without
 * being seen first. Opened from a bridge's settings (`openFavoritesImport`) and mounted once at the
 * root (`FavoritesImportHost` in _layout.tsx), same material as the list picker and confirm popup.
 *
 * The host classifies each favorite for us (see `getFavoritesImportPreview`) into three kinds, and
 * the default selection follows from that:
 *   - `new` — not in the library at all → CHECKED.
 *   - `duplicate` — the same title is already in the library from ANOTHER bridge → UNCHECKED. Left
 *     alone you keep one entry; checking it imports this bridge as a SECOND SOURCE for that series
 *     and records the link (`linkTo`), so the two are known to be the same work.
 *   - `in-library` — already here from this same bridge → inert, nothing to do.
 * Erring toward unchecked on a duplicate is deliberate: a title match is a strong hint, not proof,
 * and one extra library card is a worse outcome than one series the user adds themselves.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ANDROID_BLUR,
  BACKDROP_BLUR,
  BACKDROP_TINT,
  BACKDROP_TINT_OPACITY,
  MENU_BLUR,
  MENU_FILL,
} from '@/components/context-menu-material';
import { CheckIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { showToast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import type { FavoritesImportCandidate, FavoritesImportItem } from '@/data/api';
import { favoritesImportPreviewQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { hapticImpactLight } from '@/lib/haptics';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const OPEN_SPRING = { damping: 18, stiffness: 320, mass: 0.7 } as const;
const CARD_MAX_WIDTH = 400;
const MAX_LIST_HEIGHT = 360;
const THUMB_W = 32;

export type FavoritesImportRequest = {
  bridgeId: string;
  /** Display name, for the card's subheading and the "already here via …" lines. */
  bridgeName: string;
};

// Plain module store read via useSyncExternalStore, mirroring the confirm popup and list picker —
// this is an overlay opened imperatively from anywhere, not screen state.
let current: FavoritesImportRequest | null = null;
const listeners = new Set<() => void>();
function setRequest(req: FavoritesImportRequest | null): void {
  current = req;
  for (const l of listeners) l();
}

/** Open the favorites-import confirmation for a bridge. */
export function openFavoritesImport(req: FavoritesImportRequest): void {
  setRequest(req);
}

function useRequest(): FavoritesImportRequest | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => current,
    () => current,
  );
}

/** Root-mounted host (see app/_layout.tsx) — renders the open request, if any. */
export function FavoritesImportHost() {
  const req = useRequest();
  if (!req) return null;
  return <HostCard key={req.bridgeId} req={req} />;
}

function HostCard({ req }: { req: FavoritesImportRequest }) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const { nameOf } = useBridgeMap();

  const { data, error, isLoading, refetch, isFetching } = useQuery(
    favoritesImportPreviewQuery(ds, mock, req.bridgeId),
  );
  const items = data?.items ?? [];

  // Everything the user CAN act on. An `in-library` row is inert, so it never enters the selection.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const selectable = items.filter((i) => i.status !== 'in-library');
  // Seed once per resolved preview: the `new` rows checked, duplicates left for the user to opt into.
  const seededRef = useRef<FavoritesImportCandidate[] | null>(null);
  useEffect(() => {
    if (!data || seededRef.current === data.items) return;
    seededRef.current = data.items;
    setSelected(new Set(data.items.filter((i) => i.status === 'new').map((i) => i.seriesId)));
  }, [data]);

  const [importError, setImportError] = useState<string | null>(null);

  const dismiss = () => {
    progress.set(
      withTiming(0, { duration: 120 }, (finished) => {
        if (finished) runOnJS(close)();
      }),
    );
  };
  // Only clear the slot if this request still owns it — a late dismiss must not close a newer card.
  const close = () => {
    if (current === req) setRequest(null);
  };

  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    progress.set(withSpring(1, OPEN_SPRING));
    if (Platform.OS === 'web') return; // BackHandler is native-only (it throws on web).
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (seriesId: string) => {
    hapticImpactLight();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seriesId)) next.delete(seriesId);
      else next.add(seriesId);
      return next;
    });
  };

  const allSelected = selectable.length > 0 && selected.size === selectable.length;
  const toggleAll = () => {
    hapticImpactLight();
    setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.seriesId)));
  };

  const importMutation = useMutation({
    mutationFn: () => {
      const chosen: FavoritesImportItem[] = items
        .filter((i) => selected.has(i.seriesId))
        .map((i) => ({
          seriesId: i.seriesId,
          title: i.title,
          ...(i.thumbnailUrl !== undefined && { thumbnailUrl: i.thumbnailUrl }),
          // A checked duplicate is the user saying "same work" — link it to the entry that's already
          // here. The first match wins; a title matching several entries is rare enough that picking
          // among them isn't worth a second decision in this dialog.
          ...(i.status === 'duplicate' && i.matches?.[0] && { linkTo: i.matches[0].key }),
        }));
      return ds.importBridgeFavorites(req.bridgeId, chosen);
    },
    onSuccess: (result) => {
      // Only library-side state moved — no bridge content changed, so this stays targeted rather
      // than a blanket invalidate.
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraryLists(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.favoritesImportPreview(mock, req.bridgeId) });
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'inLibrary' });

      const linked = result.linked > 0 ? ` (${result.linked} linked as another source)` : '';
      showToast(result.imported === 0 ? 'Nothing to import' : `${result.imported} series imported${linked}`);
      dismiss();
    },
    onError: (e) => setImportError(friendlyError(e, 'Could not import favorites')),
  });

  const runImport = () => {
    if (importMutation.isPending || selected.size === 0) return;
    setImportError(null);
    importMutation.mutate();
  };

  const backdropBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 1], [0, BACKDROP_BLUR.plain]),
  }));
  const scrimOpacity = BACKDROP_TINT_OPACITY[scheme];
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, scrimOpacity]),
  }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [16, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.94, 1]) },
    ],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      <AnimatedBlurView
        tint={scheme}
        animatedProps={backdropBlurProps}
        experimentalBlurMethod={ANDROID_BLUR}
        style={StyleSheet.absoluteFill}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP_TINT[scheme] }, backdropTintStyle]}
        />
        <Pressable
          testID="favorites-import.dismiss"
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
          accessibilityLabel="Close"
        />
      </AnimatedBlurView>

      <View pointerEvents="box-none" style={[styles.cardHost, { paddingBottom: insets.bottom + Spacing.six }]}>
        <Animated.View style={[styles.cardShadow, cardStyle]}>
          <BlurView tint={scheme} intensity={MENU_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={styles.card}>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: MENU_FILL[scheme] }]} />

            <View style={styles.header}>
              <View style={styles.headerText}>
                <ThemedText type="smallBold">Import favorites</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {selectable.length > 0
                    ? `${selected.size} of ${selectable.length} from ${req.bridgeName}`
                    : req.bridgeName}
                </ThemedText>
              </View>
              {selectable.length > 0 && (
                <Pressable
                  testID="favorites-import.selectAll"
                  onPress={toggleAll}
                  hitSlop={8}
                  accessibilityRole="button">
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {allSelected ? 'None' : 'All'}
                  </ThemedText>
                </Pressable>
              )}
            </View>

            {isLoading ? (
              <View style={styles.state}>
                <ActivityIndicator size="small" />
                <ThemedText type="small" themeColor="textSecondary">
                  Loading favorites…
                </ThemedText>
              </View>
            ) : error ? (
              <View style={styles.state}>
                {/* A bridge with no credentials throws its own actionable message ("favorites require
                    a username + password…") — surface it verbatim, since the fields it names are on
                    the very screen this dialog opened from. */}
                <ThemedText type="small" style={[styles.stateText, { color: theme.danger }]}>
                  {friendlyError(error, 'Could not load favorites')}
                </ThemedText>
                <Pressable testID="favorites-import.retry" onPress={() => void refetch()} hitSlop={8}>
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {isFetching ? 'Retrying…' : 'Retry'}
                  </ThemedText>
                </Pressable>
              </View>
            ) : items.length === 0 ? (
              <View style={styles.state}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.stateText}>
                  This account has no favorites on {req.bridgeName}.
                </ThemedText>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: MAX_LIST_HEIGHT }} keyboardShouldPersistTaps="handled">
                {items.map((item) => (
                  <CandidateRow
                    key={item.seriesId}
                    item={item}
                    selected={selected.has(item.seriesId)}
                    onToggle={() => toggle(item.seriesId)}
                    nameOf={nameOf}
                  />
                ))}
                {data?.truncated && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.truncated}>
                    Showing the first {items.length} — this account has more favorites than one import
                    can walk.
                  </ThemedText>
                )}
              </ScrollView>
            )}

            {importError && (
              <ThemedText type="small" style={[styles.stateText, { color: theme.danger }]}>
                {importError}
              </ThemedText>
            )}

            <View style={styles.footer}>
              <Pressable
                testID="favorites-import.cancel"
                onPress={dismiss}
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                accessibilityRole="button">
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Cancel
                </ThemedText>
              </Pressable>
              <Pressable
                testID="favorites-import.confirm"
                onPress={runImport}
                disabled={selected.size === 0 || importMutation.isPending}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.backgroundSelected },
                  (pressed || importMutation.isPending) && styles.buttonPressed,
                  selected.size === 0 && styles.buttonDisabled,
                ]}
                accessibilityRole="button">
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {importMutation.isPending ? 'Importing…' : `Import ${selected.size}`}
                </ThemedText>
              </Pressable>
            </View>
          </BlurView>
        </Animated.View>
      </View>
    </View>
  );
}

function CandidateRow({
  item,
  selected,
  onToggle,
  nameOf,
}: {
  item: FavoritesImportCandidate;
  selected: boolean;
  onToggle: () => void;
  nameOf: (bridgeId: string) => string;
}) {
  const theme = useTheme();
  const thumb = useResolvedAsset(item.thumbnailUrl);
  const inLibrary = item.status === 'in-library';
  const sub =
    item.status === 'in-library'
      ? 'Already in library'
      : item.status === 'duplicate'
        ? `Also in library via ${[...new Set(item.matches?.map((m) => nameOf(m.bridgeId)) ?? [])].join(', ')}`
        : undefined;

  return (
    <Pressable
      testID={`favorites-import.row.${item.seriesId}`}
      onPress={inLibrary ? undefined : onToggle}
      disabled={inLibrary}
      style={({ pressed }) => [
        styles.row,
        inLibrary && styles.rowDisabled,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: inLibrary }}>
      <View
        style={[
          styles.checkbox,
          { borderColor: selected ? theme.accent : theme.hairline },
          selected && { backgroundColor: theme.accent },
        ]}>
        {selected && <CheckIcon color="#fff" size={14} />}
      </View>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
      ) : (
        <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]} />
      )}
      <View style={styles.rowText}>
        <ThemedText type="small" numberOfLines={1}>
          {item.title}
        </ThemedText>
        {sub && (
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            style={item.status === 'duplicate' ? { color: theme.accent } : undefined}>
            {sub}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
  },
  cardShadow: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    borderRadius: 22,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.one,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  state: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.three,
  },
  stateText: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: 12,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_W,
    aspectRatio: 2 / 3,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  truncated: {
    padding: Spacing.three,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  button: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
