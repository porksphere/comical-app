/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    // Shared accent + chrome tokens (mirrored in `dark`). Used by cards, badges,
    // chips and the series action buttons so colors aren't re-hardcoded per file.
    accent: '#3478F6',
    accentOn: '#ffffff',
    badgeInfo: '#2563eb',
    badgeWarn: '#ca8a04',
    badgeSuccess: '#16a34a',
    badgeNew: '#f59e0b',
    badgeNewOn: '#111111',
    hairline: 'rgba(0,0,0,0.12)',
    // Neutral chip fill (shared by genre + tag chips, like the reference); a
    // dedicated token so chip fill can diverge from generic surfaces later.
    chipBg: '#F0F0F3',
    chipBorder: '#B9CEF5',
    chipText: '#2257C7',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    accent: '#3478F6',
    accentOn: '#ffffff',
    badgeInfo: '#2563eb',
    badgeWarn: '#ca8a04',
    badgeSuccess: '#16a34a',
    badgeNew: '#f59e0b',
    badgeNewOn: '#111111',
    hairline: 'rgba(128,128,128,0.25)',
    chipBg: '#212225',
    chipBorder: '#2c4060',
    chipText: '#8ab4f8',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

// Bottom padding a scrolling screen reserves so its last content clears the tab
// bar. On native this is the OS tab bar; on web the mobile bottom nav is an
// absolute overlay (so content scrolls behind it, and stays visible when the bar
// fades on scroll — see app-tabs.web.tsx), so web reserves roughly the bar's
// height here. Screens add `insets.bottom` on top of this.
export const BottomTabInset = Platform.select({ ios: 50, android: 80, web: 48 }) ?? 0;
/** Max width of the series-detail reading column (cover + metadata). */
export const MaxContentWidth = 800;
/** Max width of the top-level views (browse grid, library, settings, …),
 *  centred on wider viewports. Mirrors the reference's `body { max-width:
 *  1200px; margin: … auto }` so the whole app reads at one width. Tweak here to
 *  resize every top-level view at once. */
export const MaxTopLevelWidth = 1200;
/** Content height (below the safe-area top inset) of the sticky top bars — the
 *  browse bridge/page bar and the series detail bar — so they read as one bar
 *  across views. Mirrors the reference's shared `--topbar-height`. */
export const TopBarHeight = 48;
/** Taller top-bar height used on desktop (≥768px) only. */
export const DesktopTopBarHeight = 64;
