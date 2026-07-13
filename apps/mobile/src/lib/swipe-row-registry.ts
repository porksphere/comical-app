/**
 * Tracks the one settings row currently swiped open, app-wide: opening another closes it, the way
 * every iOS list behaves — two rows sitting open at once reads as a bug.
 *
 * This lives in its own module rather than as a `let` beside the component because React's
 * compiler rules forbid a component reassigning a module-scope binding (a render-time side effect).
 * Mutating it from in here, behind functions the component calls from event handlers, is exactly
 * the escape hatch that rule expects — the same shape as `lib/series-card-menu.ts`.
 *
 * `token` is any stable per-row identity (the row passes its `useRef` object).
 */
let openRow: { token: object; close: () => void } | null = null;

/** Register `token` as the open row, closing whichever row was open before it. */
export function claimOpenRow(token: object, close: () => void) {
  if (openRow && openRow.token !== token) openRow.close();
  openRow = { token, close };
}

/** Drop `token`'s claim — a no-op if some other row has since taken it. */
export function releaseOpenRow(token: object) {
  if (openRow?.token === token) openRow = null;
}
