/**
 * What a library check turned up, as the reader's feed counts it. Free of react-native imports so
 * it can be tested.
 */

/** The part of a sync result this reads. `behind` is absent from a server older than the field. */
export type SyncFinds = { newChapters: number; behind?: { joined: number; unseen: number } };

export type FeedCounts = {
  /** Chapters the check added to the feed the reader sees. */
  shown: number;
  /** Of those, the ones that are news: a chapter joining a row that was already waiting unread
   *  was announced when that row was. */
  announced: number;
};

export function feedCounts(res: SyncFinds, caughtUpOnly: boolean): FeedCounts {
  if (!caughtUpOnly || !res.behind) return { shown: res.newChapters, announced: res.newChapters };
  const shown = Math.max(0, res.newChapters - res.behind.unseen);
  return { shown, announced: Math.max(0, shown - res.behind.joined) };
}
