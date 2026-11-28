/** A source the search can be narrowed to; the first is Everything. */
export type SearchScope = { id: string; name: string };

export type SearchScopeRowProps = {
  scopes: readonly SearchScope[];
  /** Each scope's picture, by id, as Browse's bridge menu takes them. */
  thumbnails: Record<string, string>;
  selected: string;
  onSelect: (id: string) => void;
  filters?: { count: number; onPress: () => void };
  sort?: {
    options: readonly { key: string; label: string }[];
    current: string | undefined;
    onSelect: (key: string) => void;
  };
};

/**
 * The iOS search tab's source, filters and sort, in a row under its field while the field is in
 * use and the bar has gone (`search-scope-row.ios`). Off iOS these stay in the search's own bar.
 */
export function SearchScopeRow(_props: SearchScopeRowProps) {
  return null;
}
