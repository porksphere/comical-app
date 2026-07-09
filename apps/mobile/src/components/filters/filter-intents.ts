// Pure resolution of a Series→Browse "apply this filter" intent (a tapped tag chip, or an
// Author/Artist/Type meta cell) against a bridge's loaded filter defs.
//
// This is the fragile seam: a wrong result silently drops a tag-chip navigation, and it's the exact
// logic the old `filterDefsBridgeId` mirror guarded the *timing* of. Keeping it pure — no React/RN,
// only TYPE imports from filter-types (erased at runtime, so `bun test` doesn't pull the native
// module graph) — lets it be unit-tested directly. See filter-intents.test.ts.
import type { FilterDef, FilterValue, TriState } from './filter-types';

/** Candidate filter-field ids (lowercased) a bridge might use for each meta key tapped on the
 *  Series screen — matched against `FilterDef.id` so e.g. an Author tap lands on that bridge's own
 *  author filter when it has one. */
export const META_FILTER_ALIASES: Record<'author' | 'artist' | 'type', string[]> = {
  author: ['author', 'authors'],
  artist: ['artist', 'artists'],
  type: ['type', 'format', 'category'],
};

/** A tapped tag chip: apply `tagId` to the bridge's tag filter named `filterKey`. */
export type TagIntent = { filterKey: string; tagId: string; label: string };
/** A tapped Author/Artist/Type meta cell. */
export type MetaIntent = { metaKey: 'author' | 'artist' | 'type'; value: string };

/** What a tag intent resolves to: which tag filter to touch, an id→label hint (a live-search tag
 *  filter has no static options to look the label up in), and the tri-state value to set. `null`
 *  when this bridge exposes no matching tag filter — the caller just drops the intent. */
export type TagIntentResult = { defId: string; labelHint: Record<string, string>; value: TriState };

/** What a meta intent resolves to: set a specific filter, or (no matching field/option) fall back
 *  to a plain free-text search. */
export type MetaIntentResult =
  | { kind: 'filter'; defId: string; value: FilterValue }
  | { kind: 'query'; query: string };

/** Resolve a tapped tag chip against the loaded defs. */
export function resolveTagIntent(defs: FilterDef[], intent: TagIntent): TagIntentResult | null {
  const def = defs.find((d) => d.id === intent.filterKey && d.type === 'tags');
  if (!def) return null;
  return {
    defId: def.id,
    labelHint: { [intent.tagId]: intent.label },
    value: { [intent.tagId]: 'include' } as TriState,
  };
}

/** Resolve a tapped Author/Artist/Type meta cell: prefer the bridge's own field for that meta key
 *  (so an Author tap lands on its author filter), else fall back to a free-text search. */
export function resolveMetaIntent(defs: FilterDef[], intent: MetaIntent): MetaIntentResult {
  const aliases = META_FILTER_ALIASES[intent.metaKey];
  const def = defs.find((d) => aliases.includes(d.id.toLowerCase()));
  if (def) {
    if (def.type === 'string') return { kind: 'filter', defId: def.id, value: intent.value };
    if (def.type === 'multi' || def.type === 'includeExclude' || def.type === 'tags') {
      const match = def.options?.find((o) => o.label.toLowerCase() === intent.value.toLowerCase());
      if (match) {
        return {
          kind: 'filter',
          defId: def.id,
          value: def.type === 'multi' ? [match.value] : ({ [match.value]: 'include' } as TriState),
        };
      }
    }
  }
  // No matching field (or no matching option within it) — plain free-text search, like a query intent.
  return { kind: 'query', query: intent.value };
}
