/**
 * The tracker import's row search: one tracker entry looked up on a bridge, for the user to say
 * which series it is. The series page's "+ Link tracker" form run the other way round — the same
 * source tabs, the same search typed for you, the same result rows — so the two read as one tool.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { CatalogResultRow, CatalogSearchField, catalogSearchStyles, SheetScroll, SourceTabs } from '@/components/catalog-search';
import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ApiSeriesEntry } from '@/data/api';
import { fetchBrowseScope, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { Bridge } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { testId } from '@/lib/test-id';

export function BridgeMatchSheet({
  title,
  detail,
  bridges,
  initialBridgeId,
  current,
  suggested,
  onPick,
}: {
  /** The tracker's title for the entry — the search typed and run when the sheet opens. */
  title: string;
  detail: string;
  bridges: readonly Bridge[];
  initialBridgeId: string;
  /** What the row would import as right now, if anything. */
  current?: { bridgeId: string; series: ApiSeriesEntry } | undefined;
  /** The lookup's shortlist when it found no exact match — it searched alternate titles too, so its
   *  guesses can be ones a plain title search doesn't turn up. */
  suggested?: { bridgeId: string; series: readonly ApiSeriesEntry[] } | undefined;
  onPick: (bridgeId: string, series: ApiSeriesEntry) => void;
}) {
  const theme = useTheme();
  const ds = useDataSource();
  const mock = useMockActive();
  const { closeTop } = useOverlay();
  const [bridgeId, setBridgeId] = useState(initialBridgeId);
  const [query, setQuery] = useState(title.trim());
  const [submittedQuery, setSubmittedQuery] = useState(title.trim());

  const searchQuery = useQuery({
    // The cross-bridge search's own first-page key: the same request, so the two share an answer.
    queryKey: queryKeys.bridgeSearchRail(mock, bridgeId, submittedQuery),
    queryFn: ({ signal }) => fetchBrowseScope(ds, bridgeId, { kind: 'search', query: submittedQuery }, undefined, signal),
    enabled: submittedQuery.length > 0,
  });

  const here = current?.bridgeId === bridgeId ? current.series : undefined;
  // What the screen already knows about this bridge leads, ahead of the search and whether or not it
  // turns them up, so the row's choice and the lookup's guesses are always beside the alternatives.
  const lead = [...(here ? [here] : []), ...(suggested?.bridgeId === bridgeId ? suggested.series : [])].filter(
    (s, i, all) => all.findIndex((o) => o.id === s.id) === i,
  );
  const found = submittedQuery ? searchQuery.data?.items : undefined;
  const rest: ApiSeriesEntry[] | undefined = found
    ?.filter((s) => !lead.some((l) => l.id === s.id))
    .map((s) => ({ id: s.id, title: s.title, thumbnailUrl: s.cover, ...(s.sub ? { subtitle: s.sub } : {}) }));

  const row = (s: ApiSeriesEntry, subtitle: string | undefined) => (
    <CatalogResultRow
      key={s.id}
      testID={testId('tracker-import.result', s.id)}
      thumbnailUrl={s.thumbnailUrl}
      title={s.title}
      subtitle={subtitle}
      selected={s.id === here?.id}
      onPress={() => pick(s)}
    />
  );

  const pick = (series: ApiSeriesEntry) => {
    onPick(bridgeId, series);
    closeTop();
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.heading}>
        <ThemedText type="subtitle" numberOfLines={2}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>

      <View style={catalogSearchStyles.form}>
        <SourceTabs
          sources={bridges}
          activeId={bridgeId}
          onSelect={(id) => {
            setBridgeId(id);
            setSubmittedQuery(query.trim());
          }}
          testIDFor={(id) => testId('tracker-import.source', id)}
          scroll={bridges.length > 3}
        />
        <CatalogSearchField
          testID="tracker-import.search"
          clearTestID="tracker-import.search-clear"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setSubmittedQuery('');
          }}
          onSubmit={() => setSubmittedQuery(query.trim())}
          onClear={() => {
            setQuery('');
            setSubmittedQuery('');
          }}
        />
      </View>

      <SheetScroll>
        <View style={catalogSearchStyles.results}>
          {lead.map((s) => row(s, s.id === here?.id ? 'Current match' : 'Possible match'))}
          {submittedQuery && searchQuery.isLoading ? (
            <ActivityIndicator style={styles.loading} />
          ) : searchQuery.isError ? (
            <ThemedText type="small" style={[catalogSearchStyles.resultsEmpty, { color: theme.danger }]}>
              {friendlyError(searchQuery.error, 'Search failed.')}
            </ThemedText>
          ) : rest && rest.length === 0 && lead.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={catalogSearchStyles.resultsEmpty}>
              No results.
            </ThemedText>
          ) : (
            rest?.map((s) => row(s, s.subtitle))
          )}
        </View>
      </SheetScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    gap: Spacing.three,
  },
  heading: {
    gap: Spacing.one,
  },
  loading: {
    paddingVertical: Spacing.two,
  },
});
