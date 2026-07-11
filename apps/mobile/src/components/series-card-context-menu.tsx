import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon, PlusIcon, StarIcon, type IconProps } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { closeSeriesCardMenu, useSeriesCardMenu, type SeriesCardMenuRequest } from '@/lib/series-card-menu';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const EDGE_PAD = 12; // keep the whole thing off the screen edges
const GAP = 12; // between the preview and the menu
const PREVIEW_SCALE = 2; // preview ≈ double the pressed card's width
const MAX_PREVIEW_WIDTH = 260; // cap so it doesn't get huge on wide screens
// Rough preview title height (cover + this) before the real height is measured, so the menu is
// roughly placed on the first frame and snaps tight once measured.
const PREVIEW_TITLE_ESTIMATE = 52;
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
  const req = useSeriesCardMenu();
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

  // Enter: ease the lift + menu in, with a haptic — the iOS "it popped" cue. A gentle spring (soft,
  // lightly overshooting) reads less abrupt than the old fast timing curve.
  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Snappy spring with a small pop — the pop-out should feel quick.
    progress.value = withSpring(1, { damping: 16, stiffness: 170, mass: 0.8 });
  }, [progress]);

  // On close: un-hide the source card (req.onClose) as it clears, so the card reappears exactly as the
  // preview finishes morphing back onto it.
  const finishClose = useCallback(() => {
    req.onClose?.();
    closeSeriesCardMenu();
  }, [req]);
  const dismiss = useCallback(() => {
    progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [progress, finishClose]);

  // Android hardware back closes the menu (and consumes the event).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [dismiss]);

  // ── Geometry ──────────────────────────────────────────────────────────────
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const topLimit = insets.top + EDGE_PAD;
  const bottomLimit = winH - insets.bottom - EDGE_PAD;
  const cardCenterX = rect.x + rect.width / 2;

  // Enlarged preview: ~double the card's width (capped to the screen / MAX), centered over the card.
  const previewW = Math.min(rect.width * PREVIEW_SCALE, winW - EDGE_PAD * 2, MAX_PREVIEW_WIDTH);
  const coverH = previewW / clampThumbAspect(coverAspect ?? DEFAULT_THUMB_ASPECT);
  const previewLeft = clamp(cardCenterX - previewW / 2, EDGE_PAD, winW - previewW - EDGE_PAD);

  const menuW = Math.min(MENU_WIDTH, winW - EDGE_PAD * 2);
  const menuH = ROW_HEIGHT * 2 + MENU_PAD_V * 2;
  const menuLeft = clamp(cardCenterX - menuW / 2, EDGE_PAD, winW - menuW - EDGE_PAD);

  // Real preview height (cover + FULL title) once measured; estimate before then so the first frame is
  // roughly placed. The menu always sits BELOW the whole preview, so it never covers the title.
  const [previewH, setPreviewH] = useState<number | null>(null);
  const effPreviewH = previewH ?? coverH + Spacing.two + PREVIEW_TITLE_ESTIMATE;

  // Place the preview near the pressed card, then clamp the whole {preview + gap + menu} group into
  // the safe area (shift up if it would overflow the bottom; pin to the top if taller than the space).
  const groupH = effPreviewH + GAP + menuH;
  const available = bottomLimit - topLimit;
  const previewTop = groupH <= available ? clamp(rect.y, topLimit, bottomLimit - groupH) : topLimit;
  const menuTop = previewTop + effPreviewH + GAP;

  // FLIP: the preview is laid out at its final (enlarged) frame but animates FROM the pressed card's
  // cover. With `transformOrigin: top-left`, scaling pins the top-left, so translating the top-left to
  // the card's cover top-left + scaling to the card's width makes the thumbnail start EXACTLY as the
  // card's cover (same width; same height, since both use coverAspect). The cover's border radius is
  // counter-scaled below so the visual corner stays a constant 10px through the morph.
  const fromScale = rect.width / previewW;
  const dx = rect.x - previewLeft;
  const dy = rect.y - previewTop;

  // Backdrop: the blur/tint ramp in a bit LATER than the preview (the 0→0.3 flat lead), so the card
  // reads as popping out first and the background then settles behind it.
  const backdropBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 0.3, 1], [0, 0, BACKDROP_BLUR]),
  }));
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 0, BACKDROP_TINT_OPACITY]),
  }));
  // Preview zooms out from the card to its final frame; shadow deepens as it settles.
  const previewStyle = useAnimatedStyle(
    () => ({
      opacity: interpolate(progress.value, [0, 0.35, 1], [0, 1, 1]),
      transform: [
        { translateX: interpolate(progress.value, [0, 1], [dx, 0]) },
        { translateY: interpolate(progress.value, [0, 1], [dy, 0]) },
        { scale: interpolate(progress.value, [0, 1], [fromScale, 1]) },
      ],
      shadowOpacity: progress.value * 0.3,
    }),
    [dx, dy, fromScale],
  );
  // Keep the cover's visual corner radius a constant 10px: it's inside the scaled preview, so its own
  // radius must be 10 / scale to cancel the container scale.
  const coverRadiusStyle = useAnimatedStyle(
    () => ({ borderRadius: 10 / (fromScale + (1 - fromScale) * progress.value) }),
    [fromScale],
  );
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-10, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.9, 1]) },
    ],
  }));

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

      {/* The enlarged preview (≈2× the card) with the FULL title. Measured so the menu can sit just
          below it. */}
      <Animated.View
        pointerEvents="none"
        onLayout={(e) => setPreviewH(e.nativeEvent.layout.height)}
        style={[styles.preview, { left: previewLeft, top: previewTop, width: previewW }, previewStyle]}>
        {entry.cover ? (
          <Animated.View style={[styles.previewCover, { height: coverH }, coverRadiusStyle]}>
            <Image source={{ uri: entry.cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          </Animated.View>
        ) : (
          <Animated.View style={[styles.previewCover, styles.previewCoverEmpty, { height: coverH }, coverRadiusStyle]} />
        )}
        <ThemedText style={styles.previewTitle}>{entry.title}</ThemedText>
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
    // Scale/translate about the top-left (0% 0%) so the FLIP starts exactly on the card's cover (see
    // the transform above).
    transformOrigin: '0% 0%',
    // Lifted-card shadow (opacity animated above).
    shadowColor: '#000000',
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  previewCover: {
    width: '100%',
    borderRadius: 10,
    // Clip the child image to the (animated) rounded corners.
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.2)',
  },
  previewCoverEmpty: {
    backgroundColor: 'rgba(128,128,128,0.25)',
  },
  previewTitle: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
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
