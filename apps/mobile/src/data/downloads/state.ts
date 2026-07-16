/**
 * The stable string key `bridgeId:seriesId:chapterId` identifying one chapter across the download
 * engine (its cancellation sets) and the manifest lookups.
 *
 * There used to be a Legend State "live progress" overlay here that the UI read while the engine
 * worked. It was removed: the engine now patches the manifest query caches page-by-page (see engine.ts
 * `patchProgressCaches`), so download progress rides the reliable TanStack Query subscription instead —
 * one source of truth (the manifest), and no re-render gap on the resume/reboot path.
 */
export function chapterProgressKey(bridgeId: string, seriesId: string, chapterId: string): string {
  return `${bridgeId}:${seriesId}:${chapterId}`;
}
