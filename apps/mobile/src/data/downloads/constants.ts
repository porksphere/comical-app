/**
 * The chapter id a direct (chapterless) series' download is filed under.
 *
 * The reader/data layer models "direct" as a `direct: boolean` branch with no chapter id, but the
 * downloads manifest keys every unit by `(bridgeId, seriesId, chapterId)` — so a direct series needs a
 * stable, reserved chapter id to store its single page set. The engine (enqueue), the offline
 * `getDirectPages` intercept, and the UI trigger all use this one constant.
 */
export const DIRECT_DOWNLOAD_CHAPTER_ID = '__direct__';
