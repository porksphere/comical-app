/**
 * A one-shot "search intent" handed to the Search screen — from the Series screen's tag chips /
 * meta cells, or from a card's long-press preview panel.
 *
 * Tapping a tag chip (or an Author/Artist/Type meta cell) should open Search pre-filled with a
 * matching query/filter. The setter stashes the intent here and navigates to `/search`; the Search
 * screen consumes it **on mount** (`takeSearchIntent`) and applies it against the intent's bridge.
 *
 * Three shapes, mirroring comical-web's tag chips (`navigateToQuerySearch` /
 * `navigateToFilteredSearch`): a `query` intent runs a free-text search — for
 * bridges whose tag groups carry `tagQueries`; a `tag` intent selects one of the
 * bridge's filters by `filterKey` — for bridges whose tag groups carry `tagIds`
 * (keyed "tag" for the tag-multiselect, "genre" for the genre filter); a `meta`
 * intent comes from tapping an Author/Artist/Type meta cell — Search routes it
 * into the matching filter field (if the bridge has one) and otherwise falls back
 * to a plain free-text search, same as `query`.
 */
import type { TagGroup } from '@/data/mock';

export type SearchIntent = {
  /** The **id** of the bridge this intent targets — Search selects it (ids are unique; two
   *  same-named bridges stay distinct). */
  bridgeId: string;
} & (
  | { kind: 'query'; query: string }
  | { kind: 'tag'; filterKey: string; tagId: string; label: string }
  | { kind: 'meta'; metaKey: 'author' | 'artist' | 'type'; value: string }
);

/**
 * Build the intent for a tapped tag — the shared logic behind both the Series screen's tag chips and
 * the card long-press preview's tag rows. Mirrors comical-web: a `tagQueries` entry runs a free-text
 * search; a `tagIds` entry selects one of the bridge's filters by `filterKey`. A `kind: "genre"`
 * group targets the bridge's genre filter (key "genre" by convention — a select/multiselect); every
 * other group targets the tag-multiselect (key "tag"). Returns null for a non-actionable tag (no
 * id/query at that index). Callers `setSearchIntent` it and navigate.
 */
export function tagSearchIntent(
  group: TagGroup,
  index: number,
  base: { bridgeId: string },
): SearchIntent | null {
  const query = group.tagQueries?.[index];
  const tagId = group.tagIds?.[index];
  if (query) return { ...base, kind: 'query', query };
  if (tagId) {
    const filterKey = group.kind === 'genre' ? 'genre' : 'tag';
    return { ...base, kind: 'tag', filterKey, tagId, label: group.tags[index] };
  }
  return null;
}

let pending: SearchIntent | null = null;
const listeners = new Set<() => void>();

/**
 * Stash an intent for the Search screen to pick up. Search consumes it on mount — the usual case,
 * where the setter's navigation pushes a fresh Search screen — OR, when Search is ALREADY the open
 * screen, via the listeners below. That second path is real: cards in Search's own results grid
 * carry the long-press preview, and tapping a tag in it dismisses an overlay without changing the
 * route, so there's no new mount and a mount-only read would leave the intent pending forever.
 */
export function setSearchIntent(intent: SearchIntent): void {
  pending = intent;
  listeners.forEach((l) => l());
}

/** Subscribe to intents being set. Search uses this to consume one while it's already mounted. */
export function subscribeSearchIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read and clear the pending intent — Search calls this on mount and from the subscription. */
export function takeSearchIntent(): SearchIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}
