/**
 * When the current scroll gesture BEGAN, was RELEASED (finger up), and finally came to REST — the
 * one signal both auto-hiding bars settle on.
 *
 * Both bars (the Browse/Search top bar via `useSlidingBar`, the tab bar via `useHideTabBarOnScroll`
 * + the web fade in `app-tabs`) follow the same rule: they track the scroll 1:1 in both directions,
 * but only *commit* to a state when the user lets go — all the way back in if the gesture earned
 * `COMMIT_DISTANCE` of upward scroll, all the way out otherwise. That needs a "the gesture ended"
 * event, which a scroll offset alone can't give you — hence this module. (The pixel bookkeeping
 * itself is `settleStep` in `slide-step.ts`; this is only the timing signal.)
 *
 * There's one scroller in play at a time (the focused screen's list), so this is a single shared
 * broadcast rather than per-screen state, matching `tab-bar-visibility`.
 *
 * Phases:
 * - `begin`  — `onScrollBeginDrag`, or the first scroll frame after a rest where that event doesn't
 *              exist (see `inferBegin`): a gesture started. Cancels any settle in flight, so
 *              grabbing a bar mid-animation hands it straight back to 1:1 tracking from wherever it
 *              had got to.
 * - `release`— `onScrollEndDrag`: the finger came up. An earned reveal and any dismissal fire here,
 *              so the bar finishes its move immediately rather than riding out the fling.
 * - `rest`   — `onMomentumScrollEnd`, or the idle fallback below: scrolling actually stopped. A
 *              part-way reveal snaps back here, NOT at `release` — an upward fling should get the
 *              chance to finish revealing the bar under its own momentum.
 *
 * The idle fallback covers everything the drag events can't: a web mouse wheel / trackpad (which
 * react-native-web's ScrollViewBase reports as `onScroll` only — it emits no drag events at all),
 * and any scroller that doesn't wire the handlers. It's suppressed while a drag is in progress, so
 * holding a finger still mid-gesture never counts as a release.
 */
import { Platform } from 'react-native';

export type ScrollPhase = 'begin' | 'release' | 'rest';

type Listener = (phase: ScrollPhase) => void;

/**
 * No scroll event for this long (and no finger down) ⇒ the scroll has come to rest.
 *
 * This is dead time before anything moves, and on web it is the ONLY release signal there is (no
 * drag events — see below), so every commit there waits it out. Kept short for that reason. The cost
 * of it being too short is a still-held finger on web reading as a release mid-gesture; that's a
 * self-correcting misfire rather than a stuck state, since the next scroll frame emits an inferred
 * `begin` which cancels the settle and hands the bar back to 1:1 tracking where it stood.
 */
const IDLE_MS = 100;

/**
 * Whether the first scroll frame after a rest has to stand in for `onScrollBeginDrag`. On web there
 * is no drag event to cancel a settle on, so scroll activity is the ONLY evidence of a gesture —
 * including a SECOND gesture that starts while a bar is still animating out of the first. Without
 * this, grabbing a settling bar did nothing until it finished, and the scroll it was given went
 * unrecorded.
 *
 * Deliberately NOT inferred on native, and not from "no drag events seen yet" either: there, the
 * frames arriving after a release are momentum, not a new grab, and must not take a settling bar
 * over — the bar shouldn't ride out a fling it was just dismissed by. Native has the real event.
 */
const inferBegin = Platform.OS === 'web';

const listeners = new Set<Listener>();
let dragging = false;
// Between an inferred `begin` and the `rest` that ends it (web only — see `inferBegin`).
let gesturing = false;
let lastActivity = 0;
let idle: ReturnType<typeof setTimeout> | null = null;

function emit(phase: ScrollPhase): void {
  for (const listener of listeners) listener(phase);
}

function clearIdle(): void {
  if (idle === null) return;
  clearTimeout(idle);
  idle = null;
}

// Re-arms itself instead of being reset on every scroll frame: `notifyScrollActivity` fires ~60×/s
// during a fling, and one timer that checks the clock is cheaper than 60 clear/set pairs a second.
function tick(): void {
  idle = null;
  if (dragging) return;
  const since = Date.now() - lastActivity;
  if (since < IDLE_MS) {
    idle = setTimeout(tick, IDLE_MS - since);
    return;
  }
  gesturing = false;
  emit('rest');
}

function armIdle(): void {
  if (idle === null) idle = setTimeout(tick, IDLE_MS);
}

export function subscribeScrollPhase(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyScrollBeginDrag(): void {
  dragging = true;
  gesturing = true;
  clearIdle();
  emit('begin');
}

export function notifyScrollEndDrag(): void {
  dragging = false;
  lastActivity = Date.now();
  emit('release');
  // Momentum may or may not follow; either way `rest` arrives — from onMomentumScrollEnd, or from
  // the idle timer when the list simply stopped where the finger left it.
  armIdle();
}

export function notifyScrollRest(): void {
  dragging = false;
  gesturing = false;
  clearIdle();
  emit('rest');
}

/**
 * Called from the bars' own `onScroll`: keeps the idle fallback's clock honest, and — where there's
 * no drag event to do it (see `inferBegin`) — opens the gesture, so scrolling into a bar that's
 * mid-settle takes it over at the position it had reached instead of being ignored until it lands.
 */
export function notifyScrollActivity(): void {
  lastActivity = Date.now();
  if (dragging) return;
  if (inferBegin && !gesturing) {
    gesturing = true;
    emit('begin');
  }
  armIdle();
}

/**
 * Ready-made handlers to spread onto a ScrollView/LegendList (`{...scrollPhaseHandlers}`). A stable
 * module-level object, so spreading it never changes a list's props. Compose manually where a screen
 * already owns one of these (e.g. pull-to-refresh's `onScrollEndDrag`).
 */
export const scrollPhaseHandlers = {
  onScrollBeginDrag: notifyScrollBeginDrag,
  onScrollEndDrag: notifyScrollEndDrag,
  onMomentumScrollEnd: notifyScrollRest,
} as const;
