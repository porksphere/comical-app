import { Platform, type TextStyle } from 'react-native';

/**
 * Suppress react-native-web's default focus outline on the <input> so the container border carries
 * the focus highlight instead. No-op on native.
 */
export const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;

/**
 * Baseline for every single-line TextInput that sits inside a row (search pills, inline filter
 * fields, value pills). Native text inputs don't vertically centre their text the way a Text does:
 *
 * - iOS puts the extra space from a `lineHeight` larger than the font ABOVE the glyphs, so a
 *   `fontSize: 16, lineHeight: 24` input renders its text bottom-aligned in its own box. Never set
 *   `lineHeight` on a single-line input; give it a `height` (or stretch it to the row) instead —
 *   UITextField centres its text within whatever bounds it gets.
 * - Android's EditText defaults to top gravity once the box is taller than the text, and its font
 *   padding (ascender/descender extremes) skews the glyphs off-centre even when it isn't.
 *
 * Pair with `alignSelf: 'stretch'` in a fixed-height row, or an explicit `height`, so the box the
 * text is centred in is the row itself rather than a content-measured one. Vertical padding stays
 * the caller's call (most want 0).
 */
export const SINGLE_LINE_INPUT: TextStyle = Platform.select<TextStyle>({
  android: { textAlignVertical: 'center', includeFontPadding: false },
  default: {},
}) as TextStyle;

/** `SINGLE_LINE_INPUT` for an input inside a fixed-height row: fill the row and centre in it. */
export const ROW_INPUT: TextStyle = { ...SINGLE_LINE_INPUT, alignSelf: 'stretch', paddingVertical: 0 };
