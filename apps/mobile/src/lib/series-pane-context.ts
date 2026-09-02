/**
 * "This series page is being rendered in the right-hand pane."
 *
 * Carries the pane's WIDTH rather than a flag, because that is what the page actually needs to know:
 * it sizes its hero, its action column and its reader off `useWindowDimensions`, and in a pane the
 * window is not what it has. A boolean would leave every one of those sites needing a second lookup
 * for the number.
 *
 * Separate from `lib/series-pane` so the series page can read it without importing the store that
 * `lib/nav` imports — that would close a cycle through the router the page also uses.
 */
import { createContext, useContext } from 'react';

export const SeriesPaneWidthContext = createContext<number | null>(null);

/** The pane's width, or null when the page is a full-screen route (native, and narrow web). */
export const useSeriesPaneWidth = (): number | null => useContext(SeriesPaneWidthContext);
