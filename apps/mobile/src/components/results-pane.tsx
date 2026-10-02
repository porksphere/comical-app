/**
 * The results pane — a rail's "See all" over the CONTENT REGION, beside the rail (see
 * `lib/results-pane`). Renders the real results SCREEN, which learns it is in a pane by context, the
 * way `SeriesPane` does.
 */
import { StyleSheet, View } from 'react-native';

import ResultsScreen from '@/app/results';
import { ContentWidthProvider } from '@/hooks/use-content-width';
import { useTheme } from '@/hooks/use-theme';
import { PaneNavContext, PaneParamsContext, type PaneNav } from '@/lib/pane';
import { closeResultsPane, useResultsPaneParams } from '@/lib/results-pane';

/** Declines every push — a series opened from here goes to the series pane over it — and its back
 *  closes it, back onto whatever it was opened over. */
const PANE_NAV: PaneNav = {
  push: () => false,
  back: () => {
    closeResultsPane();
    return true;
  },
  canGoBack: () => true,
};

export function ResultsPane({ left, width, top }: { left: number; width: number; top: number }) {
  const theme = useTheme();
  const params = useResultsPaneParams();
  if (!params) return null;
  return (
    <View
      testID="results.pane"
      style={[styles.pane, { left, width, paddingTop: top, backgroundColor: theme.background }]}>
      {/* Keyed on what it lists, so a second "See all" gets a fresh grid rather than the first one's
          scroll position — see SeriesPane. */}
      <View
        style={styles.body}
        key={`${params.bridgeId ?? ''}:${params.favorites ?? ''}:${params.listId ?? ''}:${params.query ?? ''}`}>
        {/* Outside the tabs' provider, so it says what the slot's does: the rail is beside it. */}
        <ContentWidthProvider width={width} sidebar>
          <PaneNavContext.Provider value={PANE_NAV}>
            <PaneParamsContext.Provider value={params}>
              <ResultsScreen />
            </PaneParamsContext.Provider>
          </PaneNavContext.Provider>
        </ContentWidthProvider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // See SeriesPane: absolute and opaque over the slot, so closing it puts the grid back untouched.
  pane: { position: 'absolute', top: 0, bottom: 0 },
  body: { flex: 1 },
});
