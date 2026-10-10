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

/**
 * `relTime` that keeps counting past a week — weeks, months, years — for a surface that shows the
 * exact date beside it anyway (see `absTime`). A bare `10/2/2026` in the age slot made the reader
 * do the subtraction; "3w ago" is the answer.
 */
export function relTimeLong(ms: number, now = Date.now()): string {
  const days = Math.round((now - ms) / 86_400_000);
  if (days < 7) return relTime(ms, now);
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.max(1, Math.round(days / 30))}mo ago`;
  return `${Math.max(1, Math.round(days / 365))}y ago`;
}

/** The moment itself, to sit under a relative age: "Oct 4, 2:14 PM" within the year, "Oct 4, 2025" past it. */
export function absTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }),
  });
}
