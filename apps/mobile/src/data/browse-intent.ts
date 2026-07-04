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
 * Two shapes, mirroring comical-web's tag chips (app.ts `navigateToQuerySearch` /
 * `navigateToFilteredSearch`): a `query` intent runs a free-text search — for
 * bridges whose tag groups carry `tagQueries` (e.g. example-source); a `tag` intent
 * selects the bridge's tag-multiselect filter by `filterKey` — for bridges whose
 * tag groups carry `tagIds` (e.g. example-bridge / example-bridge `key: "tag"` filters).
 */
export type BrowseIntent = { bridgeName: string } & (
  | { kind: 'query'; query: string }
  | { kind: 'tag'; filterKey: string; tagId: string; label: string }
);

let pending: BrowseIntent | null = null;

/** Stash an intent for the Browse tab to pick up when it next gains focus. */
export function setBrowseIntent(intent: BrowseIntent): void {
  pending = intent;
}

/** Read and clear the pending intent — Browse calls this from its focus effect. */
export function takeBrowseIntent(): BrowseIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}
