import SeriesReaderScreen from '@/app/series/index';
import { InSeriesPageStack } from '@/lib/series-nav';

/**
 * The series page as a route INSIDE a tab's native stack (iOS — see `tab-stack`): the same screen
 * as the root `/series`, under the context its cards and search layer read to drill as layers
 * rather than push a second page. The root route gets that context from its own layout, which
 * also hosts the nested stack for the downloads sub-pages; a tab has no nested stack, so from an
 * in-tab series those push to the root routes as before (see `useSeriesSubPath`).
 */
export default function TabSeriesRoute() {
  return (
    <InSeriesPageStack.Provider value={true}>
      <SeriesReaderScreen />
    </InSeriesPageStack.Provider>
  );
}
