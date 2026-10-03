/**
 * Compact "x ago" relative time for history/activity timestamps, falling back to
 * a locale date past a week. Ported from comical-web's `relTime` (app.ts) so both
 * clients read the same. `now` is for a caller that re-renders on its own clock.
 */
export function relTime(ms: number, now = Date.now()): string {
  const secs = Math.round((now - ms) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}
