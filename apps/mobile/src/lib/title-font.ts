import { useFonts } from 'expo-font';

/**
 * The tabs' titles' typeface: Shippori Mincho B1 ExtraBold, a heavy Japanese serif with sharp wedge
 * serifs, in the spirit of a seinen series' cover (SIL Open Font License;
 * `assets/fonts/ShipporiMinchoB1-OFL.txt`), cut down to Latin — its kanji are megabytes the titles
 * never use. Embedded by the expo-font plugin (app.json) and loaded here too: on iOS loading
 * registers it with the system, which is where the navigation bar's own title finds a font by this
 * name, PostScript and all.
 */
export const TITLE_FONT = 'ShipporiMinchoB1-ExtraBold';

/** The title typeface's name once it is ready, `undefined` until then (the system's face meanwhile). */
export function useTitleFont(): string | undefined {
  const [loaded] = useFonts({ [TITLE_FONT]: require('@/assets/fonts/ShipporiMinchoB1-ExtraBold.ttf') });
  return loaded ? TITLE_FONT : undefined;
}
