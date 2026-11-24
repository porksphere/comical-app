import type { Palette } from '@/constants/theme';

/** The Material 3 colour roles the app's tokens are drawn from, as `@expo/ui` reports them. */
export type MaterialRoles = Readonly<
  Record<
    | 'primary'
    | 'onPrimary'
    | 'secondaryContainer'
    | 'onSecondaryContainer'
    | 'surface'
    | 'onSurface'
    | 'onSurfaceVariant'
    | 'surfaceContainerLow'
    | 'surfaceContainer'
    | 'surfaceContainerHigh'
    | 'surfaceContainerHighest'
    | 'outline'
    | 'outlineVariant'
    | 'error'
    | 'onError',
    string
  >
>;

/** The app's blue: the palette's seed where the wallpaper's colours are off or the device has none. */
export const MATERIAL_SEED = '#3478F6';

const BLACK = '#000000';

/** Material's dark surface is a tinted near-black; these put the page itself on black, for an OLED
 *  panel, and leave the containers on it their tone. */
export const PURE_BLACK_ROLES = { background: BLACK, surface: BLACK, surfaceContainerLowest: BLACK } as const;

// `@expo/ui` reports `#RRGGBBAA`. Every role is opaque, and call sites append an alpha of their own
// to a token (`${theme.background}00`), so the alpha comes off.
const opaque = (hex: string): string => (hex.length === 9 ? hex.slice(0, 7) : hex);

/**
 * The app's colour tokens drawn from a Material palette, so a React Native view and the Compose
 * component beside it take the same colours. The status colours and the prints' paper have no
 * Material role and keep `base`'s.
 */
export function paletteFromMaterial(roles: MaterialRoles, base: Palette, pureBlack: boolean): Palette {
  const r = Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, opaque(v)])) as MaterialRoles;
  return {
    ...base,
    text: r.onSurface,
    textSecondary: r.onSurfaceVariant,
    inkUnread: r.outline,
    background: pureBlack ? BLACK : r.surface,
    backgroundPanel: r.surfaceContainerLow,
    backgroundElement: r.surfaceContainer,
    backgroundSelected: r.surfaceContainerHighest,
    overlaySurface: r.surfaceContainerHigh,
    overlayHover: r.surfaceContainerHighest,
    overlaySelected: r.secondaryContainer,
    overlayHairline: r.outlineVariant,
    hairline: r.outlineVariant,
    barHairline: r.outlineVariant,
    accent: r.primary,
    accentHover: r.primary,
    accentOn: r.onPrimary,
    tabIconActive: r.onSurface,
    tabIconInactive: r.onSurfaceVariant,
    chipBg: r.surfaceContainerHighest,
    chipFill: r.secondaryContainer,
    chipText: r.onSecondaryContainer,
    danger: r.error,
    dangerOn: r.onError,
  };
}

/** Material 3 Expressive's corner scale, in dp. */
export const Shape = {
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  largeIncreased: 20,
  extraLarge: 28,
  extraLargeIncreased: 32,
  extraExtraLarge: 48,
  full: 9999,
} as const;

/** Material's elevation levels, in dp, for a React Native view's `elevation`. */
export const Elevation = { level0: 0, level1: 1, level2: 3, level3: 6, level4: 8, level5: 12 } as const;

// Compose states a spring as a damping RATIO; Reanimated takes the coefficient, 2ζ√(k·m) at mass 1.
const spring = (dampingRatio: number, stiffness: number) =>
  ({ stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness), mass: 1 }) as const;

/**
 * Material 3 Expressive's motion scheme as Reanimated springs (Compose's
 * `MotionScheme.expressive()`): `spatial` for what moves or resizes, which may overshoot, and
 * `effects` for colour and opacity, which may not.
 */
export const Motion = {
  spatial: { fast: spring(0.6, 800), default: spring(0.8, 380), slow: spring(0.8, 200) },
  effects: { fast: spring(1, 3800), default: spring(1, 1600), slow: spring(1, 800) },
} as const;

/** Material's state layers: how strongly a surface's content colour is laid over it. */
export const StateLayer = { hover: 0.08, focus: 0.1, pressed: 0.1, dragged: 0.16 } as const;
