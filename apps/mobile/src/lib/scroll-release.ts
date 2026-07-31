/**
 * When the current scroll gesture BEGAN, was RELEASED (finger up), and finally came to REST — the
 * one signal both auto-hiding bars settle on.
 *
 * Both bars (the Browse/Search top bar via `useSlidingBar`, the tab bar via `useHideTabBarOnScroll`
 * + the web fade in `app-tabs`) follow the same rule: they only *commit* to a state when the user
 * lets go. Revealing tracks the finger but has to reach FULL extension to stick — release it
 * part-way and it slides back out of view; hiding doesn't move the bar at all mid-gesture, it just
 * marks it and slides it away on release. That rule needs a "the gesture ended" event, which a
 * scroll offset alone can't give you — hence this module. (The pixel bookkeeping itself is
 * `settleStep` in `slide-step.ts`; this is only the timing signal.)
 *
 * There's one scroller in play at a time (the focused screen's list), so this is a single shared
 * broadcast rather than per-screen state, matching `tab-bar-visibility`.
 *
 * Phases:
 * - `begin`  — `onScrollBeginDrag`: the finger went down. Cancels any settle in flight so the new
 *              gesture takes over a bar mid-animation.
 * - `release`— `onScrollEndDrag`: the finger came up. A *pending hide* fires here, so the bar gets
 *              out of the way immediately rather than riding out the fling.
 * - `rest`   — `onMomentumScrollEnd`, or the idle fallback below: scrolling actually stopped. A
 *              part-way reveal snaps back here, NOT at `release` — an upward fling should get the
 *              chance to finish revealing the bar under its own momentum.
 *
 * The idle fallback covers everything the drag events can't: a web mouse wheel / trackpad (which
 * react-native-web's ScrollViewBase reports as `onScroll` only — it emits no drag events at all),
 * and any scroller that doesn't wire the handlers. It's suppressed while a drag is in progress, so
 * holding a finger still mid-gesture never counts as a release.
 */
export type ScrollPhase = 'begin' | 'release' | 'rest';

type Listener = (phase: ScrollPhase) => void;

/** No scroll event for this long (and no finger down) ⇒ the scroll has come to rest. */
const IDLE_MS = 140;

const listeners = new Set<Listener>();
let dragging = false;
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
  clearIdle();
  emit('rest');
}

/** Called from the bars' own `onScroll`: keeps the idle fallback's clock honest. */
export function notifyScrollActivity(): void {
  lastActivity = Date.now();
  if (dragging) return;
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
