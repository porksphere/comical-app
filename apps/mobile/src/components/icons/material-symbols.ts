import type { ImageSourcePropType } from 'react-native';

/**
 * The Material Symbol Android draws for the SF Symbol a menu row names (`MenuRowSpec.symbol`), so a
 * row names its native glyph once and each platform draws its own. Rounded, weight 400, 24dp, as
 * the vector drawables Google publishes for Android (assets/material-symbols), which the Jetpack
 * Compose menus `@expo/ui` hosts draw. Only `.android` files import this, so no other bundle carries
 * the files.
 */
const MATERIAL_SYMBOLS: Partial<Record<string, ImageSourcePropType>> = {
  'checkmark.circle': require('@/assets/material-symbols/check_circle.xml'),
  'eye.slash': require('@/assets/material-symbols/visibility_off.xml'),
  checklist: require('@/assets/material-symbols/done_all.xml'),
  folder: require('@/assets/material-symbols/folder.xml'),
  plus: require('@/assets/material-symbols/add.xml'),
  'arrow.down.circle': require('@/assets/material-symbols/arrow_circle_down.xml'),
  'arrow.down.to.line': require('@/assets/material-symbols/download.xml'),
  trash: require('@/assets/material-symbols/delete.xml'),
};

const missing = new Set<string>();

/** The Material Symbol for `symbol`. One with no counterpart here draws nothing on Android, and a
 *  development build says which, once. */
export function materialSymbol(symbol: string | undefined): ImageSourcePropType | undefined {
  if (!symbol) return undefined;
  const source = MATERIAL_SYMBOLS[symbol];
  if (!source && __DEV__ && !missing.has(symbol)) {
    missing.add(symbol);
    console.warn(`No Material Symbol for the SF Symbol "${symbol}": add one to icons/material-symbols.ts.`);
  }
  return source;
}
