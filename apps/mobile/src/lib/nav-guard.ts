/**
 * One-navigation-per-tap guard — the pure decision logic behind `@/lib/nav`.
 *
 * The problem it solves is universal to every screen that opens another one: a tap whose
 * navigation doesn't paint immediately (a heavy screen mounting, a busy JS thread, a slow
 * first query) reads as "nothing happened", so the finger taps again — and the second tap
 * lands on a Pressable whose screen is still on top, pushing a SECOND copy of the same route.
 * Backing out then walks through the duplicates one at a time. It isn't a race we can fix by
 * making the push faster: the first push has already been dispatched (and the router state
 * already updated) by the time the second touch is delivered, so nothing downstream can tell
 * the two apart. The only place the distinction still exists is *when* the taps happened.
 *
 * So: navigations are claimed against a short time window, and a claim that loses is dropped.
 *
 * Two windows, because the two cases are not equally suspicious:
 *
 * - **Same destination** (`SAME_TARGET_WINDOW_MS`) — the reported bug. Re-opening the exact
 *   same route within a second and a half is never deliberate, so this window is generous
 *   enough to cover a genuinely laggy screen (the user waits, sees nothing, taps again).
 * - **Any destination** (`ANY_TARGET_WINDOW_MS`) — a much shorter window that catches the
 *   fat-finger case (two different rows/cards hit at once, or a press that registers on both
 *   an overlay and the row beneath it). Those arrive within a frame or two of each other, so
 *   this window only has to span a moment, and it stays short so that deliberate,
 *   quick-but-sequential navigation still works.
 *
 * Going *backwards* and going *forwards* are never gated against each other: an accidental
 * double press produces two of the same thing (back+back, or push+push on the same element),
 * never a back followed by a push. Blocking that pair would only ever eat something the user
 * meant — backing out of a screen and immediately opening another one — so a claim is checked
 * against the previous one only when both point the same way. (This is not hypothetical: it's
 * exactly what the settings-walkthrough e2e flow does, tapping "Go back" and then the next
 * category, and at 400ms a browser-driven back-then-tap lost the second navigation outright.)
 *
 * Windows are measured from the last *accepted* navigation, never extended by rejected ones —
 * holding a finger down on a spammed row still lets one through per window instead of locking
 * navigation out for as long as the taps keep coming.
 *
 * Deliberately NOT keyed on "has the router state changed yet": it changes synchronously with
 * the first push, long before the new screen is on screen, so it would unlock the guard exactly
 * during the lag it exists to cover.
 *
 * This module is pure and clock-injectable so it can be unit-tested (`nav-guard.test.ts`)
 * without a navigator; `@/lib/nav` is what wires it to expo-router.
 */

/** Window for a repeat of the SAME destination — the double-tap-through-lag case. */
export const SAME_TARGET_WINDOW_MS = 1500;

/** Window for any other destination — fat-finger/simultaneous presses only. */
export const ANY_TARGET_WINDOW_MS = 150;

/**
 * Shared key for every backwards operation (`back`, `dismiss`, `dismissAll`). They're keyed
 * together on purpose: double-tapping a back arrow pops two screens, and the second pop is
 * just as unintended as a second push — regardless of which of the three APIs each caller used.
 */
export const BACK_TARGET = '\0back';

let lastTarget: string | null = null;
let lastAcceptedAt = 0;

/** True when one of the two navigations goes back and the other goes forward. */
const opposedDirections = (a: string, b: string) => (a === BACK_TARGET) !== (b === BACK_TARGET);

/**
 * A stable string identity for a navigation destination — an `Href`, in either of the forms
 * call sites use (`'/series'`, or `{ pathname, params }`). Params are sorted so two call sites
 * that build the same destination in a different key order still collide, which is the point:
 * the guard compares destinations, not object identity.
 */
export function navTargetKey(href: unknown): string {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object') {
    const { pathname, params } = href as { pathname?: unknown; params?: Record<string, unknown> };
    const path = typeof pathname === 'string' ? pathname : '';
    const query = Object.entries(params ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${String(v)}`)
      .sort()
      .join('&');
    return query ? `${path}?${query}` : path;
  }
  return String(href);
}

/**
 * Claim the right to navigate to `target`. Returns `false` when this navigation is a duplicate
 * of one already in flight (see the windows above), in which case the caller must do nothing.
 *
 * `now` is injectable for tests only; production callers pass nothing.
 */
export function claimNavigation(target: string, now: number = Date.now()): boolean {
  if (lastTarget !== null && !opposedDirections(lastTarget, target)) {
    const window = target === lastTarget ? SAME_TARGET_WINDOW_MS : ANY_TARGET_WINDOW_MS;
    if (now - lastAcceptedAt < window) return false;
  }
  lastTarget = target;
  lastAcceptedAt = now;
  return true;
}

/** Forget the last accepted navigation. Tests only — there's no reason to reset this at runtime. */
export function resetNavigationGuard(): void {
  lastTarget = null;
  lastAcceptedAt = 0;
}
