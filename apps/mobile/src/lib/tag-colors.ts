/** Matches `useActiveColorScheme()`'s return — declared here rather than exported from the theme
 *  hook, so this module stays a leaf with no imports at all. */
type Scheme = 'light' | 'dark';

/**
 * A colour per tag GROUP: the same hue for a group on every series, and never two groups sharing one
 * within a series.
 *
 * Groups are the only thing that says what kind of tag you're looking at ("Artists", "Characters",
 * "Parodies"…). The series page spends a labelled row per group to say so; the card popup can't
 * afford those rows, so it folds every group into one strip and lets COLOUR carry the grouping (see
 * `TagStrip`). That only works if it's the same colour the series page shows — hence one shared
 * source of truth, used by both.
 *
 * ── Why known labels get RESERVED slots ──────────────────────────────────────
 * Hashing the label alone gives stability but not distinctness: with a handful of hues, real labels
 * collide (measured: "Misc" and "Male Tags" want the same hue), and a strip whose Artists and Misc
 * chips are the same colour distinguishes nothing.
 *
 * Resolving that by probing to the next free hue then breaks stability in a subtler way, and this is
 * the trap worth naming: whether a group collides depends on which OTHER groups that series happens
 * to carry. A source emits a group only when the series has such tags — plenty have no "Male Tags" —
 * so "Misc" would render fuchsia on one series and amber on the next, purely because a group it never
 * had anything to do with was absent. Colour that moves means nothing.
 *
 * So the vocabulary the sources actually emit gets a HAND-ASSIGNED slot each, distinct by
 * construction. No collision, nothing to probe, and a group's colour cannot depend on its neighbours.
 * Only an unrecognized label falls back to hash-and-probe — it can still shift, but it's the tail
 * case, and it can only be displaced by a group that's genuinely present.
 *
 * Slots may be REUSED across sources that never co-occur (one series has one source's groups), which
 * is why "Theme"/"Format" style labels don't need their own reservation.
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

/**
 * Muted on purpose. These chips are METADATA — the colour is there to group them at a glance, not to
 * compete with the cover, the title, or the one action in the menu. Saturation sits around 30% (the
 * first cut ran at ~90% and shouted); the hue does the work, the intensity stays out of the way.
 *
 * Deliberately NO BLUE: `theme.accent` is blue, and a blue chip reads as "primary action".
 *
 * Hues are spread rather than evenly stepped, because muting COMPRESSES them — at low saturation
 * neighbouring hues converge into the same dusty tone. Every pair here was checked to stay apart:
 * closest is rose/orange at RGB distance 33 (a naive low-saturation ramp put violet and fuchsia at
 * 17, which is indistinguishable). If you retune one, re-check the others — that's the trap.
 */
const PALETTE: { light: string; dark: string }[] = [
  { light: '#377981', dark: '#8DBEC4' }, // 0 teal
  { light: '#734FB0', dark: '#BDAFD4' }, // 1 violet
  { light: '#A5404E', dark: '#CE979E' }, // 2 rose
  { light: '#7F692F', dark: '#C4B382' }, // 3 amber
  { light: '#337150', dark: '#88BFA1' }, // 4 green
  { light: '#763774', dark: '#B67CB4' }, // 5 fuchsia
  { light: '#AE663D', dark: '#D6B6A4' }, // 6 orange
  { light: '#48662E', dark: '#92B474' }, // 7 lime
  { light: '#4D3C2D', dark: '#8D745E' }, // 8 brown
  { light: '#737373', dark: '#ADADAD' }, // 9 grey — neutral, which suits a catch-all group
];

/**
 * The group labels the sources actually emit, each pinned to its own hue so its colour never depends
 * on which other groups a series carries. Singular/plural and the "… Tags" suffix are both in here
 * rather than stemmed: sources word these differently ("Male Tags", "male"), and a lookup table is
 * easier to audit than a stemmer that has to get "Parodies" → "parody" right.
 *
 * Adding a source with new group labels? Give its labels slots here if they can co-occur; otherwise
 * the hash fallback handles them. Reusing a slot across sources is fine — two labels only need
 * different hues if they can appear on the SAME series.
 */
const RESERVED: Record<string, number> = {
  // Genres are the lead taxonomy on most series — pin them to teal (slot 0). Shares the slot with the
  // "Artist" tag group; the sources that surface an Artist group don't surface genres, so the two
  // never collide on one series.
  genre: 0,
  genres: 0,
  artist: 0,
  artists: 0,
  group: 1,
  groups: 1,
  parody: 2,
  parodies: 2,
  character: 3,
  characters: 3,
  female: 4,
  'female tags': 4,
  male: 5,
  'male tags': 5,
  tag: 6,
  tags: 6,
  language: 7,
  languages: 7,
  demographic: 8,
  demographics: 8,
  misc: 9,
  other: 9,
  others: 9,
};

/** Border alpha, as an #RRGGBB**AA** suffix: the hue, present but not shouting, over `theme.chipBg`. */
const BORDER_ALPHA = '66';

/** FNV-1a plus a murmur3 avalanche finalizer. The finalizer is the point: raw FNV over short, similar
 *  words clusters badly — measured, it put 7 of 15 real labels on one hue — and mixing the bits
 *  scatters them before the modulo. Only unreserved labels reach this. */
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

function toColor(slot: number, scheme: Scheme): TagColor {
  const entry = PALETTE[slot % PALETTE.length]!;
  const base = scheme === 'dark' ? entry.dark : entry.light;
  return { text: base, border: `${base}${BORDER_ALPHA}` };
}

/**
 * One colour per group, index-parallel to `labels`. Takes the series' whole group list because
 * avoiding collisions among UNRESERVED labels is a property of the set (see above) — reserved ones
 * would give the same answer alone.
 */
export function tagPaletteFor(labels: string[], scheme: Scheme): TagColor[] {
  const key = (l: string) => l.trim().toLowerCase();
  const slots: (number | undefined)[] = labels.map((l) => RESERVED[key(l)]);
  // Reserved slots are claimed FIRST — including by groups later in the list — so an unknown label
  // can never squat on a hue a known group is entitled to.
  const taken = new Set<number>(slots.filter((s): s is number => s !== undefined));

  return labels.map((label, i) => {
    const reserved = slots[i];
    if (reserved !== undefined) return toColor(reserved, scheme);
    let slot = hash(key(label)) % PALETTE.length;
    for (let probe = 0; probe < PALETTE.length && taken.has(slot); probe++) {
      slot = (slot + 1) % PALETTE.length;
    }
    taken.add(slot);
    return toColor(slot, scheme);
  });
}
