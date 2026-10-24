import { observable, ObservableHint, type OpaqueObject } from '@legendapp/state';
import { Image } from 'expo-image';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { BookmarkIcon } from '@/components/icons/reader-icons';
import { Spacing } from '@/constants/theme';
import { useDismissKey } from '@/lib/dismiss-key';
import { isTypingTarget } from '@/lib/key-hold';
import { chordLabel } from '@/lib/keymap';
import { isKey, moveDirectionOf, useKeyBindings } from '@/lib/keybindings';
import { windowModalLayer } from '@/lib/window-controls';

/** One page of the spread, as it sits on screen. */
export type SpreadSide = { page: number; uri: string | undefined; saved: boolean };

export type SpreadPickRequest = {
  title: string;
  /** Left, then right, by where they are drawn — whatever the reading direction. */
  sides: readonly [SpreadSide, SpreadSide];
  onSide: (side: 0 | 1) => void;
  /** Saving offers both pages at once; filing is one page at a time. */
  onBoth?: () => void;
  /** Hung from a button: the top-right corner, in window coordinates. Otherwise centred. */
  under?: { right: number; top: number };
  /** Opened from a key: shows which key picks which. */
  keyboard: boolean;
};

// Opaque: the request carries callbacks, which an observable would take for computeds.
const spreadPick$ = observable<OpaqueObject<SpreadPickRequest> | null>(null);

export function openSpreadPick(req: SpreadPickRequest): void {
  spreadPick$.set(ObservableHint.opaque(req));
}

function closeSpreadPick(): void {
  spreadPick$.set(null);
}

const bothOpen = (req: SpreadPickRequest) => !!req.onBoth && req.sides.some((s) => !s.saved);

function pickSide(req: SpreadPickRequest, side: 0 | 1): void {
  closeSpreadPick();
  req.onSide(side);
}

function pickBoth(req: SpreadPickRequest): void {
  if (!bothOpen(req)) return;
  closeSpreadPick();
  req.onBoth?.();
}

/**
 * The picker's keys, which answer at once rather than walking a highlight: Left and Right take the
 * page on that side of the screen, Up and Down take both, and the save key again puts it away. Every
 * other key stops here, Escape excepted (`useDismissKey`), since the reader's own capture listeners
 * would turn the page under it. Installed once at startup, ahead of any reader, so it runs first.
 */
export function installSpreadPickKeys(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener(
    'keydown',
    (e) => {
      const req = spreadPick$.peek();
      if (!req || isTypingTarget(e.target)) return;
      if (e.key === 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const move = moveDirectionOf(e);
      if (move?.x) pickSide(req, move.x < 0 ? 0 : 1);
      else if (move?.y) pickBoth(req);
      else if (isKey(e, 'save')) closeSpreadPick();
    },
    true,
  );
}

function useSpreadPick(): SpreadPickRequest | null {
  return useSyncExternalStore(
    (onStoreChange) => spreadPick$.onChange(onStoreChange),
    () => spreadPick$.peek(),
    () => spreadPick$.peek(),
  );
}

/** Root-mounted (app/_layout); renders the open request, if any. */
export function SpreadPickHost() {
  const req = useSpreadPick();
  return req ? <SpreadPick req={req} /> : null;
}

const THUMB_W = 72;
const THUMB_H = 104;
const PAIR_W = 54;
const PAIR_GAP = 2;

/**
 * Like the rest of the reader chrome it is deliberately UNTHEMED — white on dark — because the
 * reader stays dark whatever the app theme is. Laid out as the spread is, so the choice reads as the
 * page itself rather than a label for it.
 */
function SpreadPick({ req }: { req: SpreadPickRequest }) {
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.set(withTiming(1, { duration: 140 }));
  }, [shown]);
  useDismissKey(closeSpreadPick);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: 0.96 + 0.04 * shown.value }] }));
  const [left, right] = req.sides;
  const both = bothOpen(req);

  const panel = (
    <Animated.View style={[styles.panel, fade]} testID="reader.collect-page.picker">
      <Text style={styles.title}>{req.title}</Text>
      <View style={styles.row}>
        <Tile
          testID="reader.collect-page.left"
          label={`Left · ${left.page + 1}`}
          keys={req.keyboard ? <SideKeys action="left" /> : null}
          saved={left.saved}
          onPress={() => pickSide(req, 0)}>
          <Thumb side={left} width={THUMB_W} />
        </Tile>
        {req.onBoth ? (
          <Tile
            testID="reader.collect-page.both"
            label="Both"
            keys={req.keyboard ? <BothKeys /> : null}
            saved={!both}
            disabled={!both}
            onPress={() => pickBoth(req)}>
            <View style={styles.pair}>
              <Thumb side={left} width={PAIR_W} />
              <Thumb side={right} width={PAIR_W} />
            </View>
          </Tile>
        ) : null}
        <Tile
          testID="reader.collect-page.right"
          label={`Right · ${right.page + 1}`}
          keys={req.keyboard ? <SideKeys action="right" /> : null}
          saved={right.saved}
          onPress={() => pickSide(req, 1)}>
          <Thumb side={right} width={THUMB_W} />
        </Tile>
      </View>
    </Animated.View>
  );

  return (
    <View {...windowModalLayer} style={StyleSheet.absoluteFill}>
      <Pressable
        testID="reader.collect-page.picker-backdrop"
        style={StyleSheet.absoluteFill}
        onPress={closeSpreadPick}
        accessibilityLabel="Close"
      />
      {req.under ? (
        <View pointerEvents="box-none" style={[styles.hang, { top: req.under.top, right: req.under.right }]}>
          {panel}
        </View>
      ) : (
        <View pointerEvents="box-none" style={styles.centre}>
          {panel}
        </View>
      )}
    </View>
  );
}

function Tile({
  label,
  keys,
  saved,
  disabled,
  onPress,
  testID,
  children,
}: {
  label: string;
  keys: ReactNode;
  saved: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: saved }}
      style={(state) => [
        styles.tile,
        (state as { hovered?: boolean }).hovered && styles.tileHover,
        state.pressed && styles.tilePressed,
        disabled && styles.tileDisabled,
      ]}>
      <View>
        {children}
        {saved ? (
          <View style={styles.badge}>
            <BookmarkIcon color="#fff" size={12} filled />
          </View>
        ) : null}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {keys}
    </Pressable>
  );
}

function Thumb({ side, width }: { side: SpreadSide; width: number }) {
  return (
    <View style={[styles.thumb, { width }]}>
      {side.uri ? (
        <Image source={{ uri: side.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
      ) : (
        <Text style={styles.thumbNumber}>{side.page + 1}</Text>
      )}
    </View>
  );
}

const MAC = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

function Caps({ chords }: { chords: string[] }) {
  return (
    <View style={styles.caps}>
      {chords.map((c) => (
        <View key={c} style={styles.cap}>
          <Text style={styles.capText}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

function SideKeys({ action }: { action: 'left' | 'right' }) {
  const chords = useKeyBindings(action);
  return <Caps chords={chords.slice(0, 2).map((c) => chordLabel(c, MAC))} />;
}

function BothKeys() {
  const up = useKeyBindings('up');
  const down = useKeyBindings('down');
  return <Caps chords={[up[0], down[0]].flatMap((c) => (c ? [chordLabel(c, MAC)] : []))} />;
}

const styles = StyleSheet.create({
  hang: {
    position: 'absolute',
  },
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    padding: Spacing.two,
    paddingTop: Spacing.two + Spacing.half,
    borderRadius: 14,
    backgroundColor: 'rgba(24,24,27,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  title: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  tile: {
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    padding: Spacing.two,
    borderRadius: 10,
  },
  tileHover: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  tilePressed: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  tileDisabled: {
    opacity: 0.45,
  },
  pair: {
    flexDirection: 'row',
    gap: PAIR_GAP,
  },
  thumb: {
    height: THUMB_H,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbNumber: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 18,
    fontWeight: '600',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  caps: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  cap: {
    minWidth: 20,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
  },
  capText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
  },
});
