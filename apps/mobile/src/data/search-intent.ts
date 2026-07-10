/**
 * A one-shot "search intent" handed from the Series screen to the Search screen.
 *
 * Tapping a tag chip (or an Author/Artist/Type meta cell) on a series should open
 * Search pre-filled with a matching query/filter. The Series screen stashes the
 * intent here and pushes `/search`; the Search screen consumes it **on mount**
 * (`takeSearchIntent`) and applies it against the intent's bridge.
 *
 * Three shapes, mirroring comical-web's tag chips (`navigateToQuerySearch` /
 * `navigateToFilteredSearch`): a `query` intent runs a free-text search — for
 * bridges whose tag groups carry `tagQueries`; a `tag` intent selects the
 * bridge's tag-multiselect filter by `filterKey` — for bridges whose tag groups
 * carry `tagIds` (keyed "tag" by convention); a `meta` intent comes from tapping
 * an Author/Artist/Type meta cell — Search routes it into the matching filter
 * field (if the bridge has one) and otherwise falls back to a plain free-text
 * search, same as `query`.
 */
export type SearchIntent = {
  bridgeName: string;
} & (
  | { kind: 'query'; query: string }
  | { kind: 'tag'; filterKey: string; tagId: string; label: string }
  | { kind: 'meta'; metaKey: 'author' | 'artist' | 'type'; value: string }
);

let pending: SearchIntent | null = null;

/** Stash an intent for the Search screen to pick up when it mounts. */
export function setSearchIntent(intent: SearchIntent): void {
  pending = intent;
}

/** Read and clear the pending intent — Search calls this on mount. */
export function takeSearchIntent(): SearchIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}
