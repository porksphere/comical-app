/**
 * The Search screen as a pane over the CONTENT REGION, beside the rail (see `lib/bridge-search-pane`).
 * Renders the real screen, which learns it is in a pane by context, the way `ResultsPane` does.
 */
import { StyleSheet, View } from 'react-native';

import SearchScreen from '@/app/search';
import { ContentWidthProvider } from '@/hooks/use-content-width';
import { useTheme } from '@/hooks/use-theme';
import { closeBridgeSearchPane } from '@/lib/bridge-search-pane';
import { PaneNavContext, type PaneNav } from '@/lib/pane';

/** Declines every push — a series or "See all" opened from here goes to its own pane over it — and
 *  its back closes it. */
const PANE_NAV: PaneNav = {
  push: () => false,
  back: () => {
    closeBridgeSearchPane();
    return true;
  },
  canGoBack: () => true,
};

export function BridgeSearchPane({ left, width, top }: { left: number; width: number; top: number }) {
  const theme = useTheme();
  return (
    <View
      testID="bridge-search.pane"
      style={[styles.pane, { left, width, paddingTop: top, backgroundColor: theme.background }]}>
      {/* Outside the tabs' provider, so it says what the slot's does: the rail is beside it. */}
      <ContentWidthProvider width={width} sidebar>
        <PaneNavContext.Provider value={PANE_NAV}>
          <SearchScreen />
        </PaneNavContext.Provider>
      </ContentWidthProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  // See SeriesPane: absolute and opaque over the slot, so closing it puts the grid back untouched.
  pane: { position: 'absolute', top: 0, bottom: 0 },
});
