import { Platform, type TextStyle } from 'react-native';

/**
 * Suppress react-native-web's default focus outline on the <input> so the container border carries
 * the focus highlight instead. No-op on native.
 */
export const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;

/**
 * Baseline for every single-line TextInput that sits inside a row (search pills, inline filter
 * fields, value pills). Text inputs don't vertically centre their text the way a Text does:
 *
 * - iOS puts the extra space from a `lineHeight` larger than the font ABOVE the glyphs, so a
 *   `fontSize: 16, lineHeight: 24` input renders its text bottom-aligned in its own box. Never set
 *   `lineHeight` on a single-line input on native; give it a `height` (or stretch it to the row)
 *   instead — UITextField centres its text within whatever bounds it gets.
 * - Android's EditText defaults to top gravity once the box is taller than the text, and its font
 *   padding (ascender/descender extremes) skews the glyphs off-centre even when it isn't.
 * - Web is the opposite of iOS: Chrome centres an <input>'s line box, but at `line-height: normal`
 *   it draws the glyphs about 1px low (the placeholder 2px), at every device pixel ratio — measured
 *   against a Text label beside it. An explicit line height puts the baseline exactly on the
 *   label's, so web gets one.
 *
 * Takes the font size because the web line height is derived from it. Pair with `alignSelf:
 * 'stretch'` in a fixed-height row, or an explicit `height`, so the box the text is centred in is
 * the row itself rather than a content-measured one. Vertical padding stays the caller's call (most
 * want 0).
 */
export function singleLineInput(fontSize: number): TextStyle {
  return Platform.select<TextStyle>({
    android: { fontSize, textAlignVertical: 'center', includeFontPadding: false },
    web: { fontSize, lineHeight: Math.round(fontSize * 1.25) },
    default: { fontSize },
  });
}

/** `singleLineInput` for an input inside a fixed-height row: fill the row and centre in it. */
export function rowInput(fontSize: number): TextStyle {
  return { ...singleLineInput(fontSize), alignSelf: 'stretch', paddingVertical: 0 };
}
