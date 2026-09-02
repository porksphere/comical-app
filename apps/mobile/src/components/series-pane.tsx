/**
 * The series pane — the series page over the CONTENT REGION rather than over the window.
 *
 * It covers the grid it was opened from and stops at the rail, which stays lit and usable beside
 * it: the page you left is one click away in the nav you never lost, and the page's own chevron is
 * the way back to the grid underneath.
 *
 * WEB ONLY (see `lib/series-pane` for why it exists and why it has no URL). What it renders is the
 * real series SCREEN, not a copy: it is a route component, so everything it needs to know about
 * being in a pane arrives by context.
 *
 * - `InSeriesPageStack` so a card inside it DRILLS — a related series becomes a layer over this one,
 *   which is the page's own mechanism and already right here. Without it those cards would push
 *   `/series`, and the pane would take that push back and replace itself, losing the series you
 *   drilled from.
 * - `PaneNavContext` so the page's back closes the pane rather than unwinding the app beneath it.
 * - `SeriesPaneWidthContext` so it measures against the pane and not the window.
 * - `PaneParamsContext` because it was never pushed, so there are no route params to read.
 */
import { StyleSheet, View } from 'react-native';

import SeriesReaderScreen from '@/app/series/index';
import { useTheme } from '@/hooks/use-theme';
import { PaneNavContext, PaneParamsContext, type PaneNav } from '@/lib/pane';
import { closeSeriesPane, useSeriesPane } from '@/lib/series-pane';
import { SeriesPaneWidthContext } from '@/lib/series-pane-context';
import { InSeriesPageStack } from '@/lib/series-nav';

/**
 * Declines every push. The page's own sub-pages (downloads) are still routes, and its related
 * series are layers rather than navigations — so `back` is the only thing the pane has an answer
 * for, and it is the one that matters: a series page's back means "close me".
 */
const PANE_NAV: PaneNav = {
  push: () => false,
  back: () => {
    closeSeriesPane();
    return true;
  },
  canGoBack: () => true,
};

export function SeriesPane({ left, width, top }: { left: number; width: number; top: number }) {
  const theme = useTheme();
  const { params } = useSeriesPane();
  if (!params) return null;
  return (
    <View
      testID="series.pane"
      // `left` is the rail's own width, so the pane starts exactly where the content it replaces
      // did — no border of its own, since the rail already draws the hairline on that seam.
      style={[styles.pane, { left, width, paddingTop: top, backgroundColor: theme.background }]}>
      {/* Keyed on the series so opening another from the grid gets a fresh mount rather than
          handing the next one the previous one's chapter list, scroll and reader state — the
          screen is written expecting exactly that, because a route push is what it usually is. */}
      <View style={styles.body} key={`${params.bridgeId ?? ''}:${params.id ?? ''}`}>
        <SeriesPaneWidthContext.Provider value={width}>
          <InSeriesPageStack.Provider value={true}>
            <PaneNavContext.Provider value={PANE_NAV}>
              <PaneParamsContext.Provider value={params}>
                <SeriesReaderScreen />
              </PaneParamsContext.Provider>
            </PaneNavContext.Provider>
          </InSeriesPageStack.Provider>
        </SeriesPaneWidthContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolute for the same reason the rail is: `TabSlot` has to stay a direct child of `Tabs`, so
  // nothing here can be its sibling in a row. Opaque, and it covers the slot rather than insetting
  // it — the grid underneath keeps its own width, so closing the pane puts it back exactly as it
  // was instead of reflowing every card.
  pane: { position: 'absolute', top: 0, bottom: 0 },
  body: { flex: 1 },
});
