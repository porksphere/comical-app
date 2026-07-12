/** Matches `useActiveColorScheme()`'s return — declared here rather than exported from the theme
 *  hook, so this module stays a leaf with no imports at all. */
type Scheme = 'light' | 'dark';

/**
 * A colour per tag GROUP, stable across series and guaranteed distinct within one.
 *
 * Groups are the only thing that says what kind of tag you're looking at ("Artist", "Character",
 * "Parody"…), and the series page spends a whole labelled row per group to say so. The card popup
 * can't afford those rows, so it folds every group into one strip and lets COLOUR carry the grouping
 * instead (see `TagStrip`). That only works if it's the same colour the series page shows — hence one
 * shared source of truth, used by both.
 *
 * Two properties, and they pull against each other:
 *
 *   STABLE   — "Artist" should look the same on every series and every bridge, so the colour is
 *              derived by hashing the label. Nothing to fetch, store, or keep in sync, and a bridge
 *              can invent any group it likes and still get a sensible colour.
 *   DISTINCT — within ONE series, two groups must never share a colour, or the strip stops
 *              distinguishing anything. Hashing alone doesn't give you this: on real data
 *              (artist/character/parody/group/language/female/male/mixed…) several labels collide on
 *              the same hue no matter how good the mixer is — the birthday problem, with 8 buckets.
 *
 * So: hash first, then resolve collisions by probing to the next free hue, in the series' own group
 * order. Groups keep their natural colour in the common case, and a clash only shifts the LATER
 * group. Deterministic either way — the same series always renders the same colours.
 *
 * The palette is hand-picked rather than a hue rotation: evenly-spaced HSL produces muddy
 * yellow-greens, and each entry needs its own light/dark value (a colour legible on a white panel is
 * washed out on a dark one).
 */
export type TagColor = {
  /** Chip label + the group's own heading on the series page. */
  text: string;
  /** Chip outline — the same hue, faint, over the neutral chip fill. */
  border: string;
};

// Deliberately no blue: `theme.accent` is blue, and a blue chip reads as "primary action".
const PALETTE: { light: string; dark: string }[] = [
  { light: '#0E7490', dark: '#67E8F9' }, // teal
  { light: '#6D28D9', dark: '#C4B5FD' }, // violet
  { light: '#BE123C', dark: '#FDA4AF' }, // rose
  { light: '#B45309', dark: '#FCD34D' }, // amber
  { light: '#15803D', dark: '#86EFAC' }, // green
  { light: '#A21CAF', dark: '#F0ABFC' }, // fuchsia
  { light: '#C2410C', dark: '#FDBA74' }, // orange
  { light: '#4338CA', dark: '#A5B4FC' }, // indigo
];

/** Border alpha, as an #RRGGBB**AA** suffix: the hue, present but not shouting, over `theme.chipBg`. */
const BORDER_ALPHA = '66';

/** FNV-1a plus a murmur3 avalanche finalizer. The finalizer is the point: raw FNV over short, similar
 *  words ("Male", "Mixed", "Tags") clusters badly — measured, it put 7 of 15 real group labels on one
 *  hue — and mixing the bits scatters them properly before the modulo. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function toColor(index: number, scheme: Scheme): TagColor {
  const entry = PALETTE[index % PALETTE.length]!;
  const base = scheme === 'dark' ? entry.dark : entry.light;
  return { text: base, border: `${base}${BORDER_ALPHA}` };
}

/**
 * One colour per group, index-parallel to `labels` — pass a series' whole group list, not one label,
 * because avoiding collisions is a property of the SET (see above).
 *
 * Matching is case/whitespace-insensitive, so "Artist" and "artist " — which different bridges will
 * absolutely both emit — land on the same hue. More groups than hues (>8) is the one case where two
 * must share: the palette wraps, and that's fine, since a series with nine tag groups has bigger
 * legibility problems than colour reuse.
 */
export function tagPaletteFor(labels: string[], scheme: Scheme): TagColor[] {
  const taken = new Set<number>();
  return labels.map((label) => {
    let i = hash(label.trim().toLowerCase()) % PALETTE.length;
    // Probe to the next free hue on a clash — only until every hue is spoken for, after which reuse
    // is unavoidable and we just take the natural one.
    for (let probe = 0; probe < PALETTE.length && taken.has(i); probe++) {
      i = (i + 1) % PALETTE.length;
    }
    taken.add(i);
    return toColor(i, scheme);
  });
}
