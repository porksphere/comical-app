/** A contract rating's 0–1 `score` on the ten-point scale the app prints it on: 0.79 → "7.9". */
export function formatScore(score: number): string {
  return (Math.min(1, Math.max(0, score)) * 10).toFixed(1);
}

/** A vote count short enough for a meta cell: 950, 1.3K, 48K, 2.1M. */
export function formatVotes(votes: number): string {
  if (votes < 1000) return String(votes);
  // Anything that would round up to "1000K" is a million already.
  const [unit, suffix] = votes < 999_500 ? [1000, 'K'] : [1_000_000, 'M'];
  const n = votes / unit;
  return `${n < 99.95 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)}${suffix}`;
}
