/**
 * A one-shot "search intent" handed from the Series screen to the Browse tab.
 *
 * Tapping a tag chip on a series should drop Browse into a matching search. Browse
 * is a separate tab route, so the Series screen stashes the intent here and
 * navigates to the tab; Browse consumes it **on focus** (`useFocusEffect`). Doing
 * it on focus — rather than on a background re-render while the Series screen is
 * still on top — means the intent is applied by whichever Browse instance is
 * actually shown after navigation, which survives a tab remount and any deferred
 * background render.
 *
 * Three shapes, mirroring comical-web's tag chips (app.ts `navigateToQuerySearch` /
 * `navigateToFilteredSearch`): a `query` intent runs a free-text search — for
 * bridges whose tag groups carry `tagQueries`; a `tag` intent
 * selects the bridge's tag-multiselect filter by `filterKey` — for bridges whose
 * tag groups carry `tagIds` (keyed "tag" by convention); a
 * `meta` intent comes from tapping the Author/Artist/Type meta cell — Browse
 * tries to route it into the matching filter field (if the bridge has one) and
 * otherwise falls back to a plain free-text search, same as `query`.
 */
import type { TagGroup } from '@/data/mock';

export type BrowseIntent = {
  bridgeName: string;
  /** The Browse `page` (e.g. 'home', 'popular') the series screen was reached from, if it was
   *  reached from Browse itself — so consuming the intent can return to that sub-page instead of
   *  always forcing Home. Absent when the series was opened from a different tab (Library,
   *  History, …), where there's no Browse sub-page to return to. */
  originPage?: string;
} & (
  | { kind: 'query'; query: string }
  | { kind: 'tag'; filterKey: string; tagId: string; label: string }
  | { kind: 'meta'; metaKey: 'author' | 'artist' | 'type'; value: string }
);

/**
 * Build the search intent for a tapped tag chip — the shared logic behind both the Series screen's
 * tag chips and the card long-press preview's tag rows. Mirrors comical-web: a `tagQueries` entry
 * runs a free-text search; a `tagIds` entry selects the bridge's tag-multiselect filter. Returns null
 * for a non-actionable tag (no id/query at that index). Callers `setBrowseIntent` it and navigate.
 */
export function tagBrowseIntent(
  group: TagGroup,
  index: number,
  base: { bridgeName: string; originPage?: string },
): BrowseIntent | null {
  const query = group.tagQueries?.[index];
  const tagId = group.tagIds?.[index];
  if (query) return { ...base, kind: 'query', query };
  if (tagId) return { ...base, kind: 'tag', filterKey: 'tag', tagId, label: group.tags[index] };
  return null;
}

let pending: BrowseIntent | null = null;
const listeners = new Set<() => void>();

/**
 * Stash an intent for the Browse tab to pick up. Browse consumes it on focus (after navigation from a
 * pushed Series screen), OR — when it's ALREADY the focused tab (e.g. the card long-press preview,
 * a root overlay that changes no route, was opened right on Browse) — immediately, via the listeners
 * below: dismissing that overlay fires no focus change, so on-focus alone would leave the intent
 * pending until the tab was left and re-entered.
 */
export function setBrowseIntent(intent: BrowseIntent): void {
  pending = intent;
  listeners.forEach((l) => l());
}

/** Subscribe to intents being set. Browse uses this to consume one while it's already focused. */
export function subscribeBrowseIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read and clear the pending intent — Browse calls this from its focus effect / the subscription. */
export function takeBrowseIntent(): BrowseIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}
