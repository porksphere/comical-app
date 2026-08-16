/**
 * The "Add to collection…" PICKER — a floating frosted card listing the user's collections as
 * checkboxes, for filing one series into (or out of) them. Built from the same material as the
 * confirm popup and mounted once at the root (`CollectionPickerHost` in _layout.tsx, ABOVE the card
 * context-menu host so it STACKS on top of it — the "nested menus like X" behavior); anything opens
 * it via `openCollectionPicker`.
 *
 * Toggling a row persists immediately (optimistic, via `useSeriesCollections`) — filing a series
 * into any collection adds it to the library first if it wasn't there, and clearing the LAST
 * collection removes the series item outright — an item exists only as a member. A "New
 * collection…" row creates one inline and files the series into it. Tapping the backdrop or Done
 * dismisses back to whatever is underneath.
 */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextStyle } from 'react-native';
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
import { CheckIcon, PlusIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { LibrarySnapshot } from '@/data/api';
import { useSeriesCollections } from '@/hooks/use-series-collections';
import { useKeyboardLift } from '@/hooks/use-keyboard-lift';
import { useCollections } from '@/hooks/use-collections';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;
const OPEN_SPRING = { damping: 18, stiffness: 320, mass: 0.7 } as const;
const CARD_MAX_WIDTH = 340;
const MAX_LIST_HEIGHT = 320;

export type CollectionPickerRequest = {
  bridgeId: string | undefined;
  seriesId: string;
  /** Series title shown as the card's subheading. */
  title?: string;
  /** Snapshot written for the series item, and if filing adds it to the library first. */
  snapshot: () => LibrarySnapshot;
};

// Plain module store (not Legend State — the request carries a function member, `snapshot`), read via
// useSyncExternalStore, mirroring the confirm popup.
let current: CollectionPickerRequest | null = null;
const listeners = new Set<() => void>();
function setRequest(req: CollectionPickerRequest | null): void {
  current = req;
  for (const l of listeners) l();
}

/** Open the list-assign picker for a series. Stacks over whatever is already open. */
export function openCollectionPicker(req: CollectionPickerRequest): void {
  setRequest(req);
}

function useRequest(): CollectionPickerRequest | null {
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
export function CollectionPickerHost() {
  const req = useRequest();
  if (!req) return null;
  return <HostPopup key={`${req.bridgeId}:${req.seriesId}`} req={req} />;
}

function HostPopup({ req }: { req: CollectionPickerRequest }) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  const { collections, createCollection } = useCollections();
  const { collectionIds, setCollections } = useSeriesCollections(req.bridgeId, req.seriesId, req.snapshot);
  const selected = new Set(collectionIds);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newInputRef = useRef<TextInput>(null);
  // Submitting the new-collection name fires TWICE on Enter: `onSubmitEditing` runs first, its
  // `setCreating(false)` unmounts the input, and the unmount blurs it — firing `onBlur` while the
  // first submit's `createCollection` await is still in flight and `newName` is still the stale
  // text. The second call then created the same collection again. One-shot latch, reset when the row re-opens.
  const submittingRef = useRef(false);

  const dismiss = () => {
    progress.set(
      withTiming(0, { duration: 120 }, (finished) => {
        if (finished) runOnJS(close)();
      }),
    );
  };
  const close = () => {
    if (current === req) setRequest(null);
  };

  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    progress.set(withSpring(1, OPEN_SPRING));
    // Android hardware-back dismisses the picker; BackHandler is native-only (it throws on web).
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    hapticImpactLight();
    const next = selected.has(id) ? collectionIds.filter((x: string) => x !== id) : [...collectionIds, id];
    setCollections(next);
  };

  const submitNew = async () => {
    if (submittingRef.current) return; // the onBlur echo of an Enter submit — see submittingRef
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    submittingRef.current = true;
    try {
      const collection = await createCollection(name);
      // File the series into the freshly-created collection right away.
      setCollections([...collectionIds, collection.id]);
      setNewName('');
      setCreating(false);
    } finally {
      submittingRef.current = false;
    }
  };

  const backdropBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 1], [0, BACKDROP_BLUR.plain]),
  }));
  const scrimOpacity = BACKDROP_TINT_OPACITY[scheme];
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, scrimOpacity]),
  }));
  // Lift the whole card clear of the keyboard while the new-list name is being typed. This popup is
  // its own bottom-anchored card rather than an overlay sheet, so it never got the sheet-only
  // `useKeyboardAvoidingInput` treatment the other forms use — and the keyboard covered the very
  // input it opens for. e2e/mobile/registries-lists documented that gap as a workaround (the input
  // drops out of the accessibility hierarchy once covered, so the flow can't tap it) before it
  // turned into an actual failure: the field blurred two characters into "Backlog", `onBlur` below
  // committed the partial name, and a list called "Ba" was created and filed instead.
  const keyboardLift = useKeyboardLift(creating);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [16, 0]) - keyboardLift.value },
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
          testID="collection-picker.dismiss"
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
              <ThemedText type="smallBold">Add to collection</ThemedText>
              {req.title ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {req.title}
                </ThemedText>
              ) : null}
            </View>

            <ScrollView style={{ maxHeight: MAX_LIST_HEIGHT }} keyboardShouldPersistTaps="handled">
              {collections.length === 0 && !creating ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                  No collections yet. Create one below.
                </ThemedText>
              ) : (
                collections.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <Pressable
                      key={c.id}
                      testID={`collection-picker.collection.${c.id}`}
                      onPress={() => toggle(c.id)}
                      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}>
                      <View
                        style={[
                          styles.checkbox,
                          { borderColor: on ? theme.accent : theme.hairline },
                          on && { backgroundColor: theme.accent },
                        ]}>
                        {on && <CheckIcon color="#fff" size={14} />}
                      </View>
                      <ThemedText style={styles.rowLabel} numberOfLines={1}>
                        {c.name}
                      </ThemedText>
                    </Pressable>
                  );
                })
              )}

              {creating ? (
                <View style={styles.row}>
                  <View style={[styles.checkbox, { borderColor: theme.hairline }]} />
                  <TextInput
                    ref={newInputRef}
                    testID="collection-picker.new-name"
                    value={newName}
                    onChangeText={setNewName}
                    onSubmitEditing={() => void submitNew()}
                    onBlur={() => void submitNew()}
                    placeholder="Collection name…"
                    placeholderTextColor={`${theme.textSecondary}99`}
                    autoFocus
                    returnKeyType="done"
                    style={[styles.rowLabel, styles.newInput, NO_OUTLINE, { color: theme.text }]}
                  />
                </View>
              ) : (
                <Pressable
                  testID="collection-picker.new"
                  onPress={() => setCreating(true)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}
                  accessibilityRole="button">
                  <View style={styles.newIcon}>
                    <PlusIcon color={theme.accent} size={16} />
                  </View>
                  <ThemedText style={[styles.rowLabel, { color: theme.accent }]}>New collection…</ThemedText>
                </Pressable>
              )}
            </ScrollView>

            <Pressable
              testID="collection-picker.done"
              onPress={dismiss}
              style={({ pressed }) => [styles.done, { backgroundColor: theme.backgroundSelected }, pressed && styles.donePressed]}
              accessibilityRole="button"
              accessibilityLabel="Done">
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Done
              </ThemedText>
            </Pressable>
          </BlurView>
        </Animated.View>
      </View>
    </View>
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
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.one,
    gap: Spacing.half,
  },
  emptyHint: {
    padding: Spacing.three,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    height: 48,
    paddingHorizontal: Spacing.two,
    borderRadius: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newIcon: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
  },
  newInput: {
    padding: 0,
    fontSize: 16,
    lineHeight: 24,
  },
  done: {
    borderRadius: 999,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  donePressed: {
    opacity: 0.7,
  },
});
