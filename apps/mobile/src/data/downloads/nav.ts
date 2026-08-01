/**
 * Where a series' download UI lives, in one place — because it differs by shape of series:
 *
 *  - **chaptered** → the per-series download screen (`/series-downloads`), which owns the chapter
 *    roster: what's kept, what's in flight, what's still selectable.
 *  - **direct (chapterless)** → the Downloads screen (`/downloads`), focused on the series' own row.
 *    A direct series has no chapters to roster — the whole series IS the download — so sending it to
 *    the chapter screen showed a one-row list of the reserved `__direct__` sentinel. The top-level
 *    list already renders exactly what there is to see (progress, size, pause/cancel/delete).
 *
 * The focus key is the Downloads screen's own row key, so the screen can scroll that row into view
 * and flag it briefly rather than dropping the user at the top of an arbitrarily long list.
 */

/** The Downloads screen's row key for a series (`bridgeId:seriesId`). */
export function seriesRowKey(bridgeId: string, seriesId: string): string {
  return `${bridgeId}:${seriesId}`;
}

/** Route to the Downloads screen, scrolled to one series' row. */
export function downloadsScreenRoute(bridgeId: string, seriesId: string) {
  return { pathname: '/downloads' as const, params: { focus: seriesRowKey(bridgeId, seriesId) } };
}
