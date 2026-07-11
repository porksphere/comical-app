import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';

import { CheckIcon, PlusIcon, StarIcon, type IconProps } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { closeSeriesCardMenu, seriesCardMenu$, type SeriesCardMenuRequest } from '@/lib/series-card-menu';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const EDGE_PAD = 12; // keep the whole thing off the screen edges
const GAP = 10; // between the lifted card and the menu
const LIFT_SCALE = 1.06; // how much the pressed card grows as it lifts
const MENU_WIDTH = 240;
const ROW_HEIGHT = 48;
const MENU_PAD_V = Spacing.one;
// Blur strengths (0–100). The backdrop ramps in; the menu is a static frosted panel faded in by its
// own entrance (opacity/scale).
const BACKDROP_BLUR = 28;
const MENU_BLUR = 55;
// A faint extra darkening over the backdrop blur so content reads as pushed back in both themes.
const BACKDROP_TINT_OPACITY = 0.15;
// Android's blur is the experimental Dimezis path; a no-op elsewhere.
const ANDROID_BLUR = Platform.OS === 'android' ? ('dimezisBlurView' as const) : undefined;

/**
 * Root-mounted host for the native card context menu (the iOS / X hold-down): a dimmed backdrop, the
 * pressed card lifted as a preview, and a rounded menu that springs in from its edge. Rendered once
 * (see `app/_layout.tsx`); any card opens it via `openSeriesCardMenu` on long-press. Only mounted
 * while open, so its status queries cost nothing during scroll.
 */
export function SeriesCardContextMenuHost() {
  const req = use$(seriesCardMenu$);
  if (!req) return null;
  // Keyed on the entry so a re-open (rare — the backdrop blocks a second long-press) is a fresh
  // mount with a fresh entrance.
  return <ContextMenu key={req.entry.id} req={req} />;
}

function ContextMenu({ req }: { req: SeriesCardMenuRequest }) {
  const { entry, bridgeId, coverAspect, rect } = req;
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const menuTint = scheme === 'dark' ? 'dark' : 'light';
  const progress = useSharedValue(0);

  const { favorited, toggle: toggleFavorite } = useFavorite(bridgeId, entry.id);
  const { inLibrary, toggle: toggleLibrary } = useLibrary(bridgeId, entry.id, () => ({
    title: entry.title,
    ...(entry.cover ? { thumbnailUrl: entry.cover } : {}),
  }));

  // Enter: spring the lift + menu in, with a haptic — the iOS "it popped" cue.
  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    progress.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.back(1.3)) });
  }, [progress]);

  const dismiss = useCallback(() => {
    progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (finished) => {
      if (finished) runOnJS(closeSeriesCardMenu)();
    });
  }, [progress]);

  // Android hardware back closes the menu (and consumes the event).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [dismiss]);

  // ── Geometry ──────────────────────────────────────────────────────────────
  const menuW = Math.min(MENU_WIDTH, winW - EDGE_PAD * 2);
  const menuH = ROW_HEIGHT * 2 + MENU_PAD_V * 2;
  const topLimit = insets.top + EDGE_PAD;
  const bottomLimit = winH - insets.bottom - EDGE_PAD;

  // Menu below the card by default; above if it doesn't fit below (and does above).
  const belowTop = rect.y + rect.height + GAP;
  const aboveTop = rect.y - GAP - menuH;
  const placeBelow = belowTop + menuH <= bottomLimit || aboveTop < topLimit;
  const menuTop = placeBelow ? belowTop : aboveTop;
  // Left-align the menu to the card, clamped on-screen.
  const menuLeft = Math.min(Math.max(EDGE_PAD, rect.x), winW - menuW - EDGE_PAD);

  // Shift the whole group (lifted card + menu) so both stay fully on-screen: the card grows around
  // its centre, so account for the scaled bounds too.
  const cy = rect.y + rect.height / 2;
  const scaledTop = cy - (rect.height * LIFT_SCALE) / 2;
  const scaledBottom = cy + (rect.height * LIFT_SCALE) / 2;
  const unionTop = Math.min(scaledTop, menuTop);
  const unionBottom = Math.max(scaledBottom, menuTop + menuH);
  let shift = 0;
  if (unionBottom > bottomLimit) shift = bottomLimit - unionBottom;
  if (unionTop + shift < topLimit) shift = topLimit - unionTop;

  // Backdrop: ramp the blur in with progress, plus a faint darkening layer over it.
  const backdropBlurProps = useAnimatedProps(() => ({ intensity: progress.value * BACKDROP_BLUR }));
  const backdropTintStyle = useAnimatedStyle(() => ({ opacity: progress.value * BACKDROP_TINT_OPACITY }));
  const previewStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: shift * progress.value },
      { scale: 1 + (LIFT_SCALE - 1) * progress.value },
    ],
    // Shadow deepens as it lifts.
    shadowOpacity: progress.value * 0.3,
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: shift + interpolate(progress.value, [0, 1], [placeBelow ? -10 : 10, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.9, 1]) },
    ],
  }));

  const coverW = rect.width;
  const coverH = coverW / clampThumbAspect(coverAspect ?? DEFAULT_THUMB_ASPECT);

  const act = (toggle: () => void) => {
    toggle();
    dismiss();
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Blurred, tap-to-dismiss backdrop (blur ramps in; a faint dark layer adds contrast). */}
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss}>
        <AnimatedBlurView
          tint="dark"
          experimentalBlurMethod={ANDROID_BLUR}
          animatedProps={backdropBlurProps}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdropTint, backdropTintStyle]} />
      </Pressable>

      {/* The lifted card preview — a copy of the pressed card at its own on-screen rect, with the
          full (unclamped) title revealed. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.preview, { left: rect.x, top: rect.y, width: rect.width }, previewStyle]}>
        {entry.cover ? (
          <Image source={{ uri: entry.cover }} style={[styles.previewCover, { height: coverH }]} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.previewCover, styles.previewCoverEmpty, { height: coverH }]} />
        )}
        <ThemedText style={styles.previewTitle} numberOfLines={3}>
          {entry.title}
        </ThemedText>
      </Animated.View>

      {/* The actions menu — a frosted (blurred) panel. */}
      <Animated.View style={[styles.menuWrap, { left: menuLeft, top: menuTop, width: menuW }, menuStyle]}>
        <BlurView
          tint={menuTint}
          intensity={MENU_BLUR}
          experimentalBlurMethod={ANDROID_BLUR}
          style={[styles.menu, { borderColor: theme.backgroundSelected }]}>
          <MenuRow
            label={inLibrary ? 'Remove from Library' : 'Add to Library'}
            Icon={inLibrary ? CheckIcon : PlusIcon}
            loading={inLibrary === null}
            active={!!inLibrary}
            onPress={() => act(toggleLibrary)}
          />
          <View style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />
          <MenuRow
            label={favorited ? 'Unfavorite' : 'Favorite'}
            Icon={StarIcon}
            loading={favorited === null}
            active={!!favorited}
            onPress={() => act(toggleFavorite)}
          />
        </BlurView>
      </Animated.View>
    </View>
  );
}

function MenuRow({
  label,
  Icon,
  loading,
  active,
  onPress,
}: {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  loading: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = loading ? theme.textSecondary : active ? theme.accent : theme.text;
  return (
    <Pressable
      onPress={loading ? undefined : onPress}
      disabled={loading}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText style={[styles.rowLabel, { color }]} numberOfLines={1}>
        {label}
      </ThemedText>
      <Icon color={color} size={19} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdropTint: {
    backgroundColor: '#000000',
  },
  preview: {
    position: 'absolute',
    gap: Spacing.two,
    // Lifted-card shadow (opacity animated above).
    shadowColor: '#000000',
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  previewCover: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: 'rgba(128,128,128,0.2)',
  },
  previewCoverEmpty: {
    backgroundColor: 'rgba(128,128,128,0.25)',
  },
  previewTitle: {
    fontWeight: '600',
  },
  menuWrap: {
    position: 'absolute',
    // Shadow lives on the wrap (not the blur panel, which clips it with overflow: hidden), following
    // its rounded bounds so the frosted menu reads as floating.
    borderRadius: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  menu: {
    borderRadius: 14,
    paddingVertical: MENU_PAD_V,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: ROW_HEIGHT,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.four,
  },
});
