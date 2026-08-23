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
    // Modal/overlay-sheet surface — between `background` and `backgroundElement`
    // so rows/buttons drawn on it (which use `backgroundElement`) still stand
    // out, matching the dark theme's tiering (see its comment).
    backgroundPanel: '#F7F7F9',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    // Shared accent + chrome tokens (mirrored in `dark`). Used by cards, badges,
    // chips and the series action buttons so colors aren't re-hardcoded per file.
    accent: '#3478F6',
    // Lighter tint of `accent` for hovering a solid accent-filled surface (the
    // primary action button) — brightens toward white rather than dimming via
    // opacity, matching the neutral-surface hover treatment (`backgroundSelected`).
    accentHover: '#5A90FF',
    accentOn: '#ffffff',
    badgeInfo: '#2563eb',
    badgeWarn: '#ca8a04',
    badgeSuccess: '#16a34a',
    badgeNew: '#f59e0b',
    badgeNewOn: '#111111',
    hairline: 'rgba(0,0,0,0.12)',
    // THE divider for both bars — the top bars' bottom edge and the bottom nav
    // bar's top one (see `barHairline` on dark for why it's its own token rather
    // than the generic `hairline`). `tabIconActive`/`Inactive` are the bottom
    // bar's selected/unselected icon tints.
    barHairline: '#E0E1E6',
    tabIconActive: '#000000',
    tabIconInactive: '#8E8E93',
    // Neutral chip fill (shared by genre + tag chips, like the reference); a
    // dedicated token so chip fill can diverge from generic surfaces later.
    chipBg: '#F0F0F3',
    chipBorder: '#B9CEF5',
    chipText: '#2257C7',
    // Destructive actions/errors (uninstall, remove registry, save failures) —
    // was hardcoded per-callsite as '#E5484D'; centralized here so it reads from
    // the theme like every other color and stays in sync across screens.
    danger: '#E5484D',
  },
  dark: {
    text: '#ffffff',
    // Pure black, deliberately — NOT the reference site's `body { background:
    // #0f0f0f }`, which this used to mirror. The two aren't really solving the
    // same problem: a slightly-off-black keeps a browser page from looking
    // starker than the rest of the web, whereas this is a phone app on an OLED
    // panel, where pure black is what the platform's own dark surfaces do and
    // where #0f0f0f is a lit grey next to them. It also puts the bar divider
    // back on the footing it was sampled at (see `barHairline`).
    background: '#000000',
    // Modal/overlay-sheet surface. Reference uses a 3-tier scheme here —
    // `#filter-overlay-panel { background: #161618 }` vs. `button.ms-trigger
    // { background: #1c1c1e }` for the rows/buttons drawn on it — closer
    // together than `background`→`backgroundElement`'s jump, which is why
    // reusing either of those for the sheet either mismatched the page (this
    // token) or swallowed the rows' contrast (`backgroundElement`, below).
    backgroundPanel: '#17181b',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    accent: '#3478F6',
    accentHover: '#5A90FF',
    accentOn: '#ffffff',
    badgeInfo: '#2563eb',
    badgeWarn: '#ca8a04',
    badgeSuccess: '#16a34a',
    badgeNew: '#f59e0b',
    badgeNewOn: '#111111',
    hairline: 'rgba(128,128,128,0.25)',
    // THE divider for both bars — the top bars' bottom edge and the bottom nav
    // bar's top one. Its own token, and a step BRIGHTER than the generic
    // `hairline` (which lands at ~rgb(43,43,43) over this background) and than
    // the old bottom-bar border (#242427): the bars are painted `background`,
    // exactly the colour of the page they sit on, so this line is the only thing
    // that marks one off at all, and what reads as a subtle edge on a card is
    // nearly invisible as the sole boundary of a whole bar.
    //
    // The value is sampled, not picked: rgb(49,52,54) off the bar divider in a
    // reference screenshot. That app draws it over pure black — and so, now, do
    // we (see `background`), so it clears its background by the same ~50 here as
    // it does there rather than the ~37 it managed over the old #0f0f0f.
    // Active icon is pure white, inactive the iOS system gray (reads on both themes).
    barHairline: '#313436',
    tabIconActive: '#ffffff',
    tabIconInactive: '#8E8E93',
    chipBg: '#212225',
    chipBorder: '#2c4060',
    chipText: '#8ab4f8',
    danger: '#E5484D',
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
// bar. The bar (app-tabs.tsx) is the same custom-rendered absolute overlay on
// every platform — content scrolls behind it and stays visible when it fades on
// scroll (web only) — so this is roughly its height everywhere. Screens add
// `insets.bottom` on top of this.
export const BottomTabInset = 48;
/**
 * Breathing room between a top bar and the first content beneath it — added ON TOP of the bar's own
 * height (which only gets content *clear* of the bar, flush against it).
 *
 * EVERY screen with a top bar derives its content's top padding from this: the pushed screens
 * (series, settings, registries, …) and the three grids (Browse, Search, Library) alike. They used to
 * disagree — the grids sat at Spacing.three, the pushed screens at Spacing.four, and the series page
 * at zero — so content started at a different height depending on where you were.
 *
 * The gap belongs to the SCROLL CONTENT, not to a header block inside it. The Library used to pay it
 * via its controls' own `paddingTop`, which is the trap here: a screen paying for it twice (once here,
 * once in a header) ends up double-padded. If a screen looks too low, check its header isn't adding a
 * leading pad of its own.
 */
export const BarContentGap = Spacing.four;
/** Max width of the series-detail reading column (cover + metadata). */
export const MaxContentWidth = 800;
/** Max width of the top-level views (browse grid, library, settings, …),
 *  centred on wider viewports. Mirrors the reference's `body { max-width:
 *  1200px; margin: … auto }` so the whole app reads at one width. Tweak here to
 *  resize every top-level view at once. */
export const MaxTopLevelWidth = 1200;
/**
 * The screen-edge gutter for the top-level CARD surfaces — the Browse feed (rails, headings, grid
 * rows), the results grids, Library, Search. Every one of these must pad by the SAME value or their
 * content edges visibly disagree on one screen, so it lives here. Between the original Spacing.four
 * (24, too roomy) and the briefly-tried 12 (too flush): cards reach close to the screen edge while
 * keeping a real margin.
 */
export const TopLevelGutter = Spacing.three;
/**
 * How far a top-level view is inset on EACH side to centre it within `MaxTopLevelWidth` — WEB ONLY. On
 * native (iOS/Android) a phone or tablet fills its own screen; there's no desktop margin to reclaim, so
 * capping the content to 1200 there just leaves a weird border (most visible on an iPad). Native returns
 * 0 (full device width). Callers add their own edge gutter on top of this (`TopLevelGutter` for the
 * card surfaces). */
export const topLevelCenterInset = (width: number): number =>
  Platform.OS === 'web' ? Math.max(0, (width - MaxTopLevelWidth) / 2) : 0;
/** Standard height of a tappable row — the filter bar's own controls
 *  (`CONTROL_HEIGHT` in filter-types.ts) and every selectable list row inside
 *  an overlay (genre/tag checkboxes, bridge/page picker rows, …), so a row
 *  reads the same size whether it's on the bar or in a dropdown beneath it. */
export const RowHeight = 44;
/** Breathing room above and below a `RowHeight` control sitting on a bar. Below
 *  this the 44pt chips/buttons read as squashed against the bar's edges. */
export const BarVerticalPad = Spacing.two;
/** Content height (below the safe-area top inset) of the sticky top bars — the
 *  browse bridge/page bar, the series detail bar, and the search bar — so they
 *  read as one bar across views. Mirrors the reference's shared `--topbar-height`.
 *
 *  DERIVED, not a magic number: a bar is exactly a `RowHeight` control plus
 *  `BarVerticalPad` above and below it. That's what makes the Search screen's top
 *  bar and the filter bar directly beneath it the same height *by construction* —
 *  the filter bar holds the same 44pt controls, so any other value would leave the
 *  two bars visibly mismatched (and a shorter bar squashes the chips). Change the
 *  padding or the row height and every bar in the app tracks it together. */
export const TopBarHeight = RowHeight + BarVerticalPad * 2;
/** Taller top-bar height used on desktop (≥768px) only. Must stay >= TopBarHeight
 *  so the same "control + padding" floor holds on desktop too. */
export const DesktopTopBarHeight = 64;

// ─── Settings screens ────────────────────────────────────────────────────────────
// The three numbers every settings screen is built from. They live here, with the other layout
// tokens, rather than in the components that happen to use them — a screen shouldn't have to import
// a React component module just to read a measurement.

/**
 * The horizontal gutter every settings screen pads its scroll content by. Rows cancel it out with an
 * equal negative margin (`SettingsRow`'s `escapeGutter`) so their background, press highlight, and
 * swipe-revealed delete pane all run to the screen's edge, while their TEXT still lines up at this
 * inset. Anything in a section that isn't a row (save buttons, field editors, chips) simply keeps the
 * gutter it inherits.
 *
 * The one coupling to watch: a settings screen that pads its content by something OTHER than this
 * will have its rows overhang or fall short by the difference. `useSettingsScrollPadding` is what
 * keeps them honest.
 */
export const SettingsGutter = Spacing.four;

/**
 * The height of EVERY settings row, on every settings screen. Fixed, not a minimum: descriptions are
 * clamped to one line (see `SettingsRow`) precisely so a row can't outgrow its neighbours. Before
 * this, height depended on whether a description happened to wrap — the landing's rows ran 82px, a
 * registry row (a wrapping URL) 70px, and a bridge row with no status line only 44px, so no two lists
 * lined up.
 *
 * Deliberately roomier than the two lines of text strictly need: at a snug 52 the list read as
 * cramped, and a label-over-description row wants air around it. This is the one number to turn to
 * retune the density of every settings screen at once.
 */
export const SettingsRowHeight = 64;

/**
 * Gap between a settings screen's top bar and its first row. Zero on purpose — a settings list is a
 * list, and should begin flush under the bar; the row's own padding is all the separation it needs.
 * The content tabs keep `BarContentGap` instead, where the first thing under the bar is artwork.
 *
 * Named rather than inlined so the intent survives: this is a deliberate zero, not an oversight.
 */
export const SettingsTopGap = 0;

/**
 * The `paddingTop` for a scrolling list whose rows carry their OWN vertical padding (History, settings,
 * …): begin FLUSH under the top bar, so the first ROW starts at the bar's bottom edge and the row's own
 * padding is all the separation. This avoids the recurring papercut of ALSO adding `BarContentGap` on
 * top, which double-pads and pushes the first item too far down. Pass a deliberate `gap` only where the
 * first thing under the bar is artwork that wants air.
 *
 *   paddingTop: listPaddingTop(headerHeight)              // first row flush under the bar
 *   paddingTop: listPaddingTop(headerHeight, BarContentGap)  // … with a deliberate gap
 */
export const listPaddingTop = (headerHeight: number, gap = 0): number => headerHeight + gap;
