import type { SystemSymbol } from '@/components/native-selector';

/**
 * The SF Symbol standing in for a picture a row or bar item lacks: the label's initial in a
 * filled square (a menu row) or circle (a bar button), the letter tile the overlay menus draw.
 * SF has one per letter and digit; anything else gets a question mark.
 */
export function initialSymbol(label: string, shape: 'square' | 'circle' = 'square'): SystemSymbol {
  const initial = label.trim().charAt(0).toLowerCase();
  const name = /^[a-z0-9]$/.test(initial) ? `${initial}.${shape}.fill` : `questionmark.${shape}.fill`;
  return name as SystemSymbol;
}
