/**
 * The native context menu's MATERIAL — the frosted rounded menu panel, its row component, and every
 * constant that defines how it looks and feels. Extracted from the series-card hold popup
 * (series-card-context-menu.tsx) so other hold menus (the generic `ContextMenuHost`, chapter rows)
 * render the exact same object; both hosts import from here, so the styling cannot drift.
 *
 * A frosted surface is two things: a blur, and a translucent tint OF THE SURFACE over it. The tint
 * says what the menu is MADE of; the blur lets the colour behind bleed through. Both, or it isn't a
 * material (see the long note in the card popup about the scrim it rests on).
 */
import { BlurView } from 'expo-blur';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { IconProps } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const MENU_WIDTH = 240;
export const MENU_ROW_HEIGHT = 48;
/** The selection bubble's inset from the menu's side edges. */
export const BUBBLE_INSET_H = Spacing.one;
/** The bubble's breathing room within its own row (above and below), so adjacent rows'
 *  selections don't visually touch. */
export const BUBBLE_INSET_V = 2;
/** The surface's vertical padding is DERIVED so that a first/last row's selection bubble sits the
 *  same distance from the menu's top/bottom edge as it does from the sides:
 *  MENU_PAD_V + BUBBLE_INSET_V == BUBBLE_INSET_H. */
export const MENU_PAD_V = BUBBLE_INSET_H - BUBBLE_INSET_V;
/** Optional slim title line above the rows (the generic host's header; the card popup has none —
 *  its preview panel carries the identity). */
export const MENU_TITLE_HEIGHT = 32;
export const EDGE_PAD = 12;
/**
 * Backdrop blur strengths (0–100) — a clear TWO-MODE configuration, keyed by whether the menu
 * lifts a content preview:
 *  - `preview` — the series-card popup: the heavy frost separates the lifted card from the page.
 *  - `plain`   — rows-only menus (chapter long-press, the generic host's default): lighter, so the
 *    page stays legible behind a menu that has no preview to showcase.
 */
export const BACKDROP_BLUR = { preview: 28, plain: 14 } as const;
export type BackdropBlurMode = keyof typeof BACKDROP_BLUR;
export const MENU_BLUR = 55;
// The scrim follows the theme: light washes the page out pale (what iOS does) so the light menu has
// something light to blur; dark dims to black.
export const BACKDROP_TINT = { light: '#ffffff', dark: '#000000' } as const;
export const BACKDROP_TINT_OPACITY = { light: 0.45, dark: 0.15 } as const;
// Both stay properly translucent. Light is the heavier of the two only because it also has to hold
// its own against an opaque panel beside it.
export const MENU_FILL = { light: 'rgba(255,255,255,0.55)', dark: 'rgba(23,24,27,0.62)' } as const;
// Android's blur is the experimental Dimezis path; a no-op elsewhere.
export const ANDROID_BLUR = Platform.OS === 'android' ? ('dimezisBlurView' as const) : undefined;
// The selection highlight — deliberately faint (it sits on a blurred panel; full-strength
// `backgroundSelected` read as a solid slab). It only has to say WHICH row.
export const HIGHLIGHT_OPACITY = 0.5;
// The highlight SLIDES between rows rather than blinking — snappy but not instant.
export const HOVER_SPRING = { damping: 20, stiffness: 340, mass: 0.6 } as const;
export const HOVER_FADE = { duration: 110 } as const;

/**
 * One row of a hold menu.
 *
 * ⚠️ NO `theme.accent` (BLUE) IN THIS MENU — not on state toggles, not on the primary row. That has
 * been done twice and reverted twice. If a row needs to stand out, use WEIGHT and POSITION (primary
 * is bold and leads), never hue. An "on" toggle reads through its glyph alone (`iconFilled`).
 */
export type MenuRowSpec = {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** Fill the glyph rather than tint it — how an "on" toggle reads (see above). */
  iconFilled?: boolean;
  loading: boolean;
  /** Unavailable (e.g. favorites need a login that isn't set) — greyed + inert, like loading but final. */
  disabled?: boolean;
  active?: boolean;
  /** The menu's one real action: bold and leading. NOT coloured — see above. */
  primary?: boolean;
  onPress: () => void;
  /** Automation selector — required so every menu row is reachable (see src/lib/test-id.ts). */
  testID: string;
};

/** The hold channel a menu's rows share with the gesture that opened it (each host has its own pair
 *  of shared values — the card's and the generic host's never fight). */
export type MenuHoldChannel = {
  holdActive: SharedValue<boolean>;
  hoveredRow: SharedValue<number>;
};

export function MenuRow({
  label,
  Icon,
  iconFilled,
  loading,
  disabled,
  active,
  primary,
  index,
  onPress,
  testID,
  channel,
}: MenuRowSpec & {
  /** This row's position — what the held finger is hit-tested into (see "Peek and commit"). */
  index: number;
  channel: MenuHoldChannel;
}) {
  const theme = useTheme();
  const inert = loading || !!disabled;
  const color = inert ? theme.textSecondary : theme.text;
  // An off toggle's glyph sits back a little, so the on-state (solid glyph, full contrast) reads as
  // a change without needing a colour of its own.
  const iconColor = inert ? theme.textSecondary : primary || active ? color : theme.textSecondary;
  // A row has NO highlight of its own: pressing it writes the same channel the held finger does, so
  // the one travelling bubble draws a press and a peek alike. While a hold owns the selection, the
  // press keeps its hands off (activating the hold cancels the responder → onPressOut fires, which
  // would otherwise clear the very row the hold just picked).
  return (
    <Pressable
      testID={testID}
      onPress={inert ? undefined : onPress}
      disabled={inert}
      onPressIn={() => {
        if (!channel.holdActive.value) channel.hoveredRow.set(index);
      }}
      onPressOut={() => {
        if (!channel.holdActive.value) channel.hoveredRow.set(-1);
      }}
      style={menuStyles.row}>
      <ThemedText style={[menuStyles.rowLabel, primary && menuStyles.rowLabelPrimary, { color }]} numberOfLines={1}>
        {label}
      </ThemedText>
      <Icon color={iconColor} size={19} filled={iconFilled} />
    </Pressable>
  );
}

/**
 * The frosted menu panel: blur + surface tint + the ONE travelling selection bubble + the rows
 * (and an optional slim title line above them). Positioning/animation belong to the host — this is
 * just the object itself.
 */
export function MenuSurface({
  tint,
  rows,
  channel,
  hoverStyle,
  title,
}: {
  tint: 'light' | 'dark';
  rows: MenuRowSpec[];
  channel: MenuHoldChannel;
  /** Animated style driving the travelling bubble (translateY + opacity) — host-computed, since row
   *  offsets depend on the host's header/geometry. */
  hoverStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  title?: string;
}) {
  const theme = useTheme();
  return (
    <BlurView
      tint={tint}
      intensity={MENU_BLUR}
      experimentalBlurMethod={ANDROID_BLUR}
      style={[menuStyles.menu, { borderColor: theme.backgroundSelected }]}>
      {/* The surface tint — its own layer INSIDE the blur, not a backgroundColor on the BlurView
          (expo-blur's web build applies its own tint background last and silently drops yours). */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: MENU_FILL[tint] }]} />
      {/* The travelling selection bubble, under the rows so their labels stay on top of it. */}
      <Animated.View
        pointerEvents="none"
        style={[menuStyles.hoverBubble, { backgroundColor: theme.backgroundSelected }, hoverStyle]}
      />
      {title !== undefined && (
        <View style={menuStyles.titleRow}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {title}
          </ThemedText>
        </View>
      )}
      {rows.map((row, i) => (
        <MenuRow key={i} {...row} index={i} channel={channel} />
      ))}
    </BlurView>
  );
}

export const menuStyles = StyleSheet.create({
  // The floating box around the surface (shared shadow/rounding; hosts position it themselves).
  menuWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
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
  // The selection bubble: inset from the row's edges and generously rounded, so it reads as a pill
  // sitting on the menu rather than a full-bleed band. ONE for the entire menu — positioned by
  // transform onto whichever row is selected (`top` is the within-row inset; the translate does the
  // rest). Insets come from the shared constants so the edge gaps stay equal (see MENU_PAD_V).
  hoverBubble: {
    position: 'absolute',
    left: BUBBLE_INSET_H,
    right: BUBBLE_INSET_H,
    top: BUBBLE_INSET_V,
    height: MENU_ROW_HEIGHT - BUBBLE_INSET_V * 2,
    borderRadius: 10,
  },
  titleRow: {
    height: MENU_TITLE_HEIGHT,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: MENU_ROW_HEIGHT,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
  },
  // Primary leads and is bold — that is the ONLY way it's marked. No colour. See MenuRow.
  rowLabelPrimary: {
    fontWeight: '600',
  },
});
