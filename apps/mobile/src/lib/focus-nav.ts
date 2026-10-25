import { Platform, type ViewProps } from 'react-native';

import { nextInDirection, type Direction, type Rect } from '@/lib/focus-geometry';
import { isTypingTarget } from '@/lib/key-hold';
import { isKey, moveDirectionOf, readerScopeActive } from '@/lib/keybindings';
import { largestScroller } from '@/lib/keyboard-scroll';

// Spatial focus for the desktop's `lists` keys (lib/keymap). Once the keyboard holds the focus —
// Tab, or Space or a sideways key with nothing focused — the move keys carry it to the nearest
// control in that direction instead of scrolling, Space presses it and R opens its menu. A pointer
// press hands the keys back to scrolling (the `data-input` latch in app/+html).
//
// Only what is on TOP is a candidate, judged by hit-testing its centre: whatever covers the screen
// (a pane, the settings panel, a menu) takes the focus with it, with no layer bookkeeping. A list
// virtualizes what is off screen, so a move with nothing to land on scrolls first and looks again.
//
// The focus wears the pointer's hover rather than a ring of its own: each control already draws how
// it looks under the mouse, from its own state, so the focus plays the pointer's events into it and
// a card shows its cover ring, a row its fill. Only a control whose look doesn't change under the
// pointer is tinted instead (`data-key-tint` in app/+html); the browser's ring is never shown.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// A pinned section heading is a COPY of one in the list, re-based onto another section as the list
// scrolls, so the focus would change headings under itself; the list's own heading is the one moved to.
const SKIPPED = '[aria-hidden="true"], [inert], [data-focus-skip]';

// Where the keyboard comes into a screen that has a better answer than its first control: the series
// page's actions, not the cover above them that only repeats Read.
const LANDING = '[data-focus-landing]';

// Side-by-side columns, like the series page's actions beside its details. Up and down keep to the
// column they are in, and run out of it only onto what is in no column; left and right cross to the
// neighbouring column's nearest control even when nothing in it is level. The geometry alone goes to the
// nearest ROW, which in two columns of different rhythms zig-zags between them.
const COLUMN = '[data-focus-column]';

// A screen's bars. The keyboard moves onto them but never comes INTO a screen on one: while a
// screen's body is still arriving, its bars are all that is there, and its back button is top-left.
const CHROME = '[data-focus-chrome]';

// A menu, sheet or dialog open over the page. The keys stay inside it: a move with nothing further
// in that direction stops at its edge rather than landing on the page beside it, and Tab goes round
// in it. Only the layer's own scrollers are scrolled for more.
const LAYER = '[data-focus-layer]';

type FocusMark = 'skip' | 'landing' | 'column' | 'chrome' | 'layer';

/** react-native-web renders `dataSet` as data-* attributes; react-native's types don't know it. */
export const focusMarks = (...marks: FocusMark[]) =>
  ({ dataSet: Object.fromEntries(marks.map((m) => [`focus${m[0]!.toUpperCase()}${m.slice(1)}`, ''])) }) as ViewProps;
export const focusSkip = focusMarks('skip');

const pointerMode = () => document.documentElement.getAttribute('data-input') === 'pointer';

const notChrome = (el: HTMLElement) => !el.closest(CHROME);

function onTop(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const left = Math.max(r.left, 0);
  const right = Math.min(r.right, window.innerWidth);
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.bottom, window.innerHeight);
  if (right <= left || bottom <= top) return false;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  return !!hit && el.contains(hit);
}

function heldFocus(): HTMLElement | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body || pointerMode() || isTypingTarget(el)) return null;
  return el;
}

/** The control the keyboard has the focus on — not one a click left focused, and not a field. */
export function keyboardFocus(): HTMLElement | null {
  const el = heldFocus();
  return el && onTop(el) ? el : null;
}

/** The keyboard's focus is under something that opened over it (a menu, a pane). */
const focusCovered = () => {
  const el = heldFocus();
  return !!el && !onTop(el);
};

// What the keyboard was on when it went into a menu or a pane, to come back to once that closes.
let returnTo: HTMLElement | null = null;

function enterLayer(from: HTMLElement | null): void {
  returnTo = from;
  focusFirst();
}

/**
 * A layer that has just opened takes the keyboard's focus: its selected row, else its first control.
 * The focus goes back to what opened it once the layer closes (`returnSoon`), however it closes.
 * Nothing moves for a pointer's open — the mouse is on the menu already — nor over a field the
 * layer has focused itself.
 */
export function focusLayer(root: HTMLElement | null): void {
  if (!root || pointerMode() || root.contains(document.activeElement)) return;
  const from = heldFocus();
  const pool = candidates().filter((el) => root.contains(el));
  const to = pool.find((el) => el.getAttribute('aria-selected') === 'true') ?? topLeft(pool);
  if (!to) return;
  if (from && !root.contains(from)) returnTo = from;
  focusKeyboard(to);
}

/** Watches for a quarter of a second or so, since a closing layer animates out. */
function returnSoon(): void {
  let frames = 30;
  const check = () => {
    const back = returnTo;
    if (!back || !back.isConnected || pointerMode()) return void (returnTo = null);
    if (onTop(back)) {
      const at = document.activeElement;
      if (at === document.body || at === back || !(at instanceof HTMLElement) || !onTop(at)) focusKeyboard(back);
      returnTo = null;
    } else if (--frames > 0) requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

/**
 * Escape's step out of the keyboard's focus. Inside a menu or a pane the keyboard went into, the
 * layer closes instead (false: the caller closes it) and the focus goes back to where it came from.
 */
export function letGoOfFocus(): boolean {
  const el = keyboardFocus();
  if (!el) return false;
  if (returnTo?.isConnected && !onTop(returnTo)) {
    returnSoon();
    return false;
  }
  returnTo = null;
  landed = null;
  el.blur();
  return true;
}

function scrolls(el: HTMLElement, horizontal: boolean): boolean {
  const style = getComputedStyle(el);
  const overflow = horizontal ? style.overflowX : style.overflowY;
  const room = horizontal ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1;
  return room && (overflow === 'auto' || overflow === 'scroll');
}

/** A text field is never one: it takes the keys that would move back out of it. It is reached on
 *  purpose instead — its own shortcut, Tab — and left with Escape. */
function candidates(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.closest(SKIPPED) && !isTypingTarget(el);
  });
}

/** What a move along that axis stays inside while it can: the scroller it runs through, looked for
 *  no further out than `within`. */
function regionOf(el: Element, horizontal: boolean, within: HTMLElement | null = null): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (scrolls(p, horizontal)) return p;
    if (p === within) break;
  }
  return null;
}

function canScroll(el: HTMLElement, dir: Direction): boolean {
  if (dir.x > 0) return el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
  if (dir.x < 0) return el.scrollLeft > 1;
  if (dir.y > 0) return el.scrollTop < el.scrollHeight - el.clientHeight - 1;
  return el.scrollTop > 1;
}

/** Inside `region`, anything counts, on screen or not: focusing it scrolls it in, and one under the
 *  top bar or a pinned heading is brought out (`uncover`). Outside one, only what is on top. */
function nearest(
  from: Rect,
  self: HTMLElement | null,
  dir: Direction,
  anchor: number,
  region: HTMLElement | null,
  barred?: (el: HTMLElement) => boolean,
) {
  const pool = candidates().filter(
    (el) =>
      !(self && (el.contains(self) || self.contains(el))) &&
      (region ? region.contains(el) : onTop(el)) &&
      !barred?.(el),
  );
  const i = nextInDirection(
    from,
    pool.map((el) => el.getBoundingClientRect()),
    dir,
    anchor,
  );
  return i === null ? null : pool[i]!;
}

// Where a run of moves set out from across their axis, so a run keeps to its column (or row) through
// a heading or a shorter row rather than drifting toward whatever each one puts closest. Held as an
// offset from the control it landed on, not a screen position: the list scrolls between presses (the
// wheel, a focus scrolling itself in, `uncover`), and a stale screen position names another row.
let anchor: { el: HTMLElement; horizontal: boolean; off: number } | null = null;

// What the keyboard last landed on. A list recycles a row out from under the focus, which drops it on
// the body, and the next move carries on from here instead of going nowhere.
let landed: { el: HTMLElement; rect: Rect; id: string | null; href: string } | null = null;

function recover(): { el: HTMLElement | null; rect: Rect } | null {
  if (!landed || pointerMode() || document.activeElement !== document.body || landed.href !== location.href) return null;
  const back = stillThere();
  return back ? { el: back, rect: back.getBoundingClientRect() } : { el: null, rect: landed.rect };
}

/** The control the keyboard last landed on, or the copy a list re-rendered it as. */
function stillThere(): HTMLElement | null {
  if (!landed) return null;
  const { el, id } = landed;
  if (el.isConnected && onTop(el)) return el;
  return (id && candidates().find((c) => c.getAttribute('data-testid') === id && onTop(c))) || null;
}

/** A list that moves a row's node to recycle it drops the focus on the body — the browser blurs
 *  anything moved — so the keyboard takes it straight back, where it was. */
function regain(el: EventTarget | null): boolean {
  if (landed?.el !== el || pointerMode() || landed.href !== location.href) return false;
  const back = stillThere();
  back?.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  return !!back && document.activeElement === back;
}

function focusKeyboard(el: HTMLElement): void {
  document.documentElement.removeAttribute('data-input');
  // The browser's own scroll-into-view is a jump; the glide below is the same scroll, over GLIDE_MS.
  el.focus({ focusVisible: true, preventScroll: true } as FocusOptions);
  reveal(el, () => {
    if (landed?.el === el) landed.rect = el.getBoundingClientRect();
    uncover(el);
  });
}

// ── Scrolling that catches up with the focus rather than snapping to it ──

const GLIDE_MS = 180;

// One flight per scroller: a new glide on the same one takes over from wherever it has got to, so a
// held key keeps converging on the newest focus instead of queueing a scroll per press.
const flights = new Map<HTMLElement, number>();

function cancelGlides(): void {
  for (const raf of flights.values()) cancelAnimationFrame(raf);
  flights.clear();
}

/** Scrolls `scroller` by `by` over GLIDE_MS, easing out; `done` runs only if nothing took over. */
function glide(scroller: HTMLElement, by: { top?: number; left?: number }, done?: () => void): void {
  const prior = flights.get(scroller);
  if (prior !== undefined) cancelAnimationFrame(prior);
  const fromTop = scroller.scrollTop;
  const fromLeft = scroller.scrollLeft;
  const top = by.top ?? 0;
  const left = by.left ?? 0;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / GLIDE_MS);
    const eased = 1 - (1 - t) ** 3;
    scroller.scrollTop = fromTop + top * eased;
    scroller.scrollLeft = fromLeft + left * eased;
    if (t < 1) return void flights.set(scroller, requestAnimationFrame(step));
    flights.delete(scroller);
    done?.();
  };
  flights.set(scroller, requestAnimationFrame(step));
}

/** How far past the box's near edge a span sticks out, or 0 if it fits inside (the `nearest` rule). */
function overhang(lo: number, hi: number, boxLo: number, boxHi: number): number {
  if (lo < boxLo) return lo - boxLo;
  if (hi > boxHi) return Math.min(hi - boxHi, lo - boxLo);
  return 0;
}

/** Brings `el` into every scroller it sits in, innermost first, and calls `done` once they have all
 *  landed — at once when nothing needs to move. */
function reveal(el: HTMLElement, done: () => void): void {
  const r = el.getBoundingClientRect();
  const rect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  let pending = 0;
  const landedOne = () => --pending === 0 && done();
  for (let p = el.parentElement; p; p = p.parentElement) {
    const vertical = scrolls(p, false);
    const horizontal = scrolls(p, true);
    if (!vertical && !horizontal) continue;
    const box = p.getBoundingClientRect();
    let top = vertical
      ? overhang(rect.top, rect.bottom, Math.max(box.top, 0), Math.min(box.bottom, window.innerHeight))
      : 0;
    // Into view is not out from under the bars: one glide takes both, judged where it is about to land.
    if (vertical) top += coverShift(p, { left: rect.left, right: rect.right, top: rect.top - top, bottom: rect.bottom - top });
    const left = horizontal
      ? overhang(rect.left, rect.right, Math.max(box.left, 0), Math.min(box.right, window.innerWidth))
      : 0;
    if (!top && !left) continue;
    // Where it will be once this scroller has moved, for the scrollers outside it.
    rect.top -= top;
    rect.bottom -= top;
    rect.left -= left;
    rect.right -= left;
    pending++;
    glide(p, { top, left }, landedOne);
  }
  if (!pending) done();
}

const UNCOVER_MARGIN = 8;
const EDGE_PROBE = 2;

/** How far `scroller` has to move for a control at `r` to come out from under whatever is drawn over
 *  the list — the top bar, a pinned heading, the tab bar, all overlays OUTSIDE the scroller, so what
 *  the list itself has at that spot (another row, before the scroll) is never taken for one. */
function coverShift(scroller: HTMLElement, r: Rect): number {
  const x = (r.left + r.right) / 2;
  const coverAt = (y: number) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit || scroller.contains(hit)) return null;
    let cover: Element = hit;
    while (cover.parentElement && !cover.parentElement.contains(scroller)) cover = cover.parentElement;
    return cover.getBoundingClientRect();
  };
  const over = coverAt(Math.max(r.top, 0) + EDGE_PROBE);
  if (over) return r.top - over.bottom - UNCOVER_MARGIN;
  const under = coverAt(Math.min(r.bottom, window.innerHeight) - EDGE_PROBE);
  return under ? r.bottom - under.top + UNCOVER_MARGIN : 0;
}

/** Scrolls a control out from under a cover `reveal` could not see coming: what covers a spot can
 *  change with the scroll, as a pinned heading hands over to the next section's. */
function uncover(el: HTMLElement, tries = 2): void {
  const scroller = regionOf(el, false);
  if (!scroller || !el.isConnected || document.activeElement !== el) return;
  const top = coverShift(scroller, el.getBoundingClientRect());
  if (!top) return;
  glide(scroller, { top }, () => {
    if (tries > 1) requestAnimationFrame(() => uncover(el, tries - 1));
  });
}

function move(from: HTMLElement | null, rect: Rect, dir: Direction): void {
  const horizontal = dir.x !== 0;
  const cross = (r: Rect) => (horizontal ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2);
  const at = cross(rect) + (anchor && anchor.el === from && anchor.horizontal === horizontal ? anchor.off : 0);
  const land = (to: HTMLElement) => {
    anchor = { el: to, horizontal, off: at - cross(to.getBoundingClientRect()) };
    focusKeyboard(to);
  };
  const origin = from ?? document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
  const layer = origin?.closest<HTMLElement>(LAYER) ?? null;
  const outsideLayer = (el: HTMLElement) => !!layer && !layer.contains(el);
  const column = origin?.closest<HTMLElement>(COLUMN) ?? null;
  let barred = outsideLayer;
  if (column) {
    const within = nearest(rect, from, dir, at, column, outsideLayer);
    if (within) return land(within);
    if (horizontal) {
      // As tall as the page, so the neighbour's nearest control is level with it.
      const across = { left: rect.left, right: rect.right, top: -Infinity, bottom: Infinity };
      const notANeighbour = (el: HTMLElement) => outsideLayer(el) || column.contains(el) || !el.closest(COLUMN);
      const beside = nearest(across, from, dir, at, regionOf(column, false, layer), notANeighbour);
      if (beside) land(beside);
      return;
    }
    barred = (el) => outsideLayer(el) || !!el.closest(COLUMN);
  }
  const region = origin && regionOf(origin, horizontal, layer);
  const inside = region && nearest(rect, from, dir, at, region, barred);
  if (inside) return land(inside);
  if (!region || !canScroll(region, dir)) {
    const outside = nearest(rect, from, dir, at, null, barred);
    if (outside) land(outside);
    return;
  }
  const step = (horizontal ? region.clientWidth : region.clientHeight) / 2;
  // Then a frame: the list rendering what it scrolled into.
  glide(region, { [horizontal ? 'left' : 'top']: (horizontal ? dir.x : dir.y) * step }, () =>
    requestAnimationFrame(() => {
      if (from && !from.isConnected) return;
      const next = nearest(from?.getBoundingClientRect() ?? rect, from, dir, at, region, barred);
      if (next) land(next);
    }),
  );
}

// ── The pointer's hover, played into the focused control ──
// Both kinds of hover listener get what a real pointer would send: RN-web's useHover (what Pressable's
// onHoverIn rides) listens for pointerenter/leave on the element itself, and React derives its
// onPointerEnter/Leave from pointerover/out.

let hovered: HTMLElement | null = null;

function lineage(el: HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el; p; p = p.parentElement) out.push(p);
  return out;
}

const pointer = (type: string, relatedTarget: Element | null, bubbles: boolean) =>
  new PointerEvent(type, { pointerType: 'mouse', isPrimary: true, bubbles, composed: bubbles, relatedTarget });

/** The boundary events a pointer going from `prev` to `next` would send, in the browser's order. */
function cross(prev: HTMLElement | null, next: HTMLElement | null): void {
  if (prev === next) return;
  const left = lineage(prev);
  const entered = lineage(next);
  if (prev) {
    prev.dispatchEvent(pointer('pointerout', next, true));
    for (const el of left) {
      if (entered.includes(el)) break;
      el.dispatchEvent(pointer('pointerleave', next, false));
    }
  }
  if (next) {
    next.dispatchEvent(pointer('pointerover', prev, true));
    for (const el of entered.filter((e) => !left.includes(e)).reverse()) el.dispatchEvent(pointer('pointerenter', prev, false));
  }
}

function hoverTo(next: HTMLElement | null): void {
  const prev = hovered?.isConnected ? hovered : null;
  hovered = next;
  if (prev === next) return;
  prev?.removeAttribute('data-key-tint');
  cross(prev, next);
}

// ── A mouse left lying while the keyboard is used ──
// The browser hovers whatever comes to lie under a mouse that hasn't moved — a key scrolled the list,
// opened a screen, turned a page — exactly as if the mouse had gone there. So from a key press until
// the mouse is really used again, its hover is held off: what it was on is left, and every boundary
// event the browser sends for it is dropped before any listener (RN-web's on the element, React's on
// the root). Using the mouse again — a move to a NEW position, since the browser also "moves" it in
// place after a scroll, a press, the wheel — takes the hover straight back onto whatever is under it.

const BOUNDARY = ['pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave'];
let mouseHeldOff = false;
let mouseAt: { x: number; y: number } | null = null;
let underMouse: HTMLElement | null = null;

function holdOffMouse(): void {
  if (mouseHeldOff) return;
  mouseHeldOff = true;
  const was = underMouse;
  underMouse = null;
  if (was?.isConnected) cross(was, null);
}

function mouseBack(e: PointerEvent | WheelEvent): void {
  if (e instanceof PointerEvent && hovered) hoverTo(null);
  if (!mouseHeldOff) return;
  mouseHeldOff = false;
  if (e instanceof PointerEvent && e.pointerType !== 'mouse') return;
  const at = mouseAt && document.elementFromPoint(mouseAt.x, mouseAt.y);
  if (!(at instanceof HTMLElement)) return;
  underMouse = at;
  cross(null, at);
}

function onBoundary(e: Event): void {
  if (!e.isTrusted) return;
  if (e instanceof MouseEvent) mouseAt = { x: e.clientX, y: e.clientY };
  if (mouseHeldOff) return e.stopImmediatePropagation();
  if (e.type !== 'pointerover' && e.type !== 'pointerout') return;
  const to = e.type === 'pointerover' ? e.target : (e as PointerEvent).relatedTarget;
  underMouse = to instanceof HTMLElement ? to : null;
}

function onPointerMove(e: PointerEvent): void {
  if (!e.isTrusted) return;
  const moved = !mouseAt || e.clientX !== mouseAt.x || e.clientY !== mouseAt.y;
  mouseAt = { x: e.clientX, y: e.clientY };
  if (moved) mouseBack(e);
}

const LOOK_DEPTH = 4;
const LOOK_SETTLE_MS = 60;

/** Enough of how a control is drawn to tell whether hovering it changed anything: itself, and the
 *  boxes just around it, where a wrapper's hover fill lands. */
function look(el: HTMLElement): string {
  let out = el.outerHTML;
  for (let p = el.parentElement, i = 0; p && i < LOOK_DEPTH; p = p.parentElement, i++) out += p.className + p.style.cssText;
  return out;
}

function wearHover(el: HTMLElement): void {
  // Taken back after a list moved it (`regain`): it is still hovered, and already wears it or doesn't.
  if (hovered === el) return;
  const before = look(el);
  hoverTo(el);
  // React renders a hover as an ordinary task, not before the next frame, so a frame or two can pass
  // before a control that has a hover look shows it.
  setTimeout(
    () =>
      requestAnimationFrame(() => {
        if (hovered !== el || look(el) !== before) return;
        el.setAttribute('data-key-tint', getComputedStyle(el).position === 'static' ? 'flat' : '');
      }),
    LOOK_SETTLE_MS,
  );
}

function onFocusIn(e: FocusEvent): void {
  const el = e.target;
  if (!(el instanceof HTMLElement) || pointerMode() || isTypingTarget(el)) return hoverTo(null);
  landed = { el, rect: el.getBoundingClientRect(), id: el.getAttribute('data-testid'), href: location.href };
  wearHover(el);
}

function topLeft(pool: HTMLElement[]): HTMLElement | null {
  const first = pool
    .map((el) => [el.getBoundingClientRect(), el] as const)
    .sort(([a], [b]) => a.top * 2 + a.left - (b.top * 2 + b.left))[0];
  return first ? first[1] : null;
}

function landingTarget(): HTMLElement | null {
  const onScreen = candidates().filter(onTop);
  for (const zone of document.querySelectorAll(LANDING)) {
    const first = topLeft(onScreen.filter((el) => zone.contains(el)));
    if (first) return first;
  }
  return null;
}

/** Where the keyboard comes in: the screen's landing, else the first thing in its main list, else
 *  anything on top. */
function focusFirst(): void {
  const main = largestScroller();
  const onScreen = candidates().filter(onTop);
  const body = onScreen.filter(notChrome);
  const pool = body.filter((el) => main?.contains(el));
  // Chrome only on a screen that has nothing else — not one whose body is on its way (`arriveAfter`
  // keeps watching for it while the focus stays put).
  const first = landingTarget() ?? topLeft(pool.length ? pool : body.length || arriving() ? body : onScreen);
  if (first) focusKeyboard(first);
}

// Long enough for a cold series load behind the zoom; a press that opened nothing just stops looking.
const ARRIVAL_WAIT_FRAMES = 180;

const sameRect = (a: DOMRect, b: DOMRect) =>
  a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

// The press whose screen the keyboard is waiting to land on, and whether a second press came in
// while it waited — that one goes to the landing, since it was meant for what the screen opens with.
let arrival: { from: HTMLElement; press: boolean } | null = null;

/** The press's screen has started covering what was pressed, and the landing hasn't been reached. */
const arriving = () => !!arrival && !(arrival.from.isConnected && onTop(arrival.from));

/**
 * A press that opens a screen over the keyboard's focus — a card opening its series — puts the focus
 * on that screen's landing, so the first key goes on from there instead of from whatever the screen
 * happens to start with. Only once the landing has stopped moving: it arrives inside the zoom, and
 * focusing it mid-flight scrolls its list to wherever it was that frame. A landing already showing
 * when the key went down belongs to the screen underneath (Space on Library opens a menu beside Read).
 */
function arriveAfter(from: HTMLElement): void {
  const before = landingTarget();
  const mine = { from, press: false };
  arrival = mine;
  let frames = ARRIVAL_WAIT_FRAMES;
  let last: { el: HTMLElement; rect: DOMRect } | null = null;
  const check = () => {
    if (arrival !== mine) return;
    const at = document.activeElement;
    if (pointerMode() || (at !== from && at !== document.body) || --frames <= 0) return void (arrival = null);
    const to = from.isConnected && onTop(from) ? null : landingTarget();
    const rect = to?.getBoundingClientRect();
    if (to && rect && to !== before && last?.el === to && sameRect(last.rect, rect)) {
      returnTo = from;
      arrival = null;
      focusKeyboard(to);
      if (mine.press) press(to);
      return;
    }
    last = to && rect ? { el: to, rect } : null;
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

function press(el: HTMLElement): void {
  arriveAfter(el);
  el.click();
}

/** A sideways key with nothing focused brings the focus in from that side of the main list, at the
 *  top of what it shows: Right lands on its leftmost control there, Left on its rightmost. */
function enterFrom(dir: Direction): void {
  const main = largestScroller();
  const onScreen = candidates().filter(onTop);
  const body = onScreen.filter(notChrome);
  const inMain = body.filter((el) => main?.contains(el));
  const pool = inMain.length ? inMain : body.length ? body : onScreen;
  const box = inMain.length && main ? main.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  const x = dir.x > 0 ? Math.max(box.left, 0) : Math.min(box.right, innerWidth);
  const y = Math.max(box.top, 0);
  // As tall as the list, so everything in it is level with where the move sets out.
  const i = nextInDirection(
    { left: x, right: x, top: y, bottom: Math.min(box.bottom, innerHeight) },
    pool.map((el) => el.getBoundingClientRect()),
    dir,
    y,
  );
  if (i !== null) focusKeyboard(pool[i]!);
}

const pressesItselfOnSpace = (el: HTMLElement) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || readerScopeActive() || isTypingTarget(e.target)) return;
  const dir = moveDirectionOf(e);
  if (dir) {
    const from = keyboardFocus();
    const lost = from ? null : recover();
    if (from) move(from, from.getBoundingClientRect(), dir);
    // A screen still arriving has its landing to come in on; going in now lands on its back button.
    else if (arriving() && landingTarget()) void 0;
    else if (focusCovered()) enterLayer(heldFocus());
    else if (lost) move(lost.el, lost.rect, dir);
    else if (dir.x) enterFrom(dir);
    else return;
    e.preventDefault();
    return;
  }
  if (isKey(e, 'activate')) {
    // Pressed again before the screen the first press opened has landed: meant for its landing (Read,
    // on a series), not for the covered card the focus still sits on or whatever is top-left so far.
    if (arriving()) {
      e.preventDefault();
      if (!e.repeat) arrival!.press = true;
      return;
    }
    const active = document.activeElement;
    if (e.key === ' ' && active instanceof HTMLElement && pressesItselfOnSpace(active)) {
      if (!e.repeat && keyboardFocus() === active) arriveAfter(active);
      return;
    }
    e.preventDefault();
    if (e.repeat) return;
    const focused = keyboardFocus();
    if (focused) press(focused);
    else focusFirst();
    return;
  }
  if (isKey(e, 'menu')) {
    const focused = keyboardFocus();
    if (!focused) return;
    e.preventDefault();
    if (e.repeat) return;
    // At the centre, and from what is drawn there, since the menu's listener may sit on a child.
    const r = focused.getBoundingClientRect();
    const x = (r.left + r.right) / 2;
    const y = (r.top + r.bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    const target = hit && focused.contains(hit) ? hit : focused;
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    requestAnimationFrame(() => requestAnimationFrame(() => focusCovered() && enterLayer(focused)));
  }
}

/**
 * Tab goes round the layer the focus is in, instead of out to the page under it. Captured, since the
 * reader's chrome takes Tab for its own ring from the window too.
 */
function onTabInLayer(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement;
  const layer = active instanceof HTMLElement ? active.closest<HTMLElement>(LAYER) : null;
  if (!layer) return;
  const ring = [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 && !el.closest(SKIPPED),
  );
  e.preventDefault();
  e.stopImmediatePropagation();
  if (ring.length === 0) return;
  const at = ring.indexOf(active as HTMLElement);
  ring[(at + (e.shiftKey ? -1 : 1) + ring.length) % ring.length]!.focus();
}

/** Ahead of lib/keyboard-scroll, which scrolls only what this leaves alone. */
export function installFocusNav(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', (e) => {
    if (e.relatedTarget) return;
    const from = e.target;
    // A frame later, once a list moving the node has put it back.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body && !regain(from)) hoverTo(null);
    });
    // A menu closes itself on Escape and takes the focus with it.
    if (returnTo) returnSoon();
  });
  window.addEventListener('keydown', (e) => e.isTrusted && holdOffMouse(), true);
  window.addEventListener('keydown', onTabInLayer, true);
  for (const type of BOUNDARY) window.addEventListener(type, onBoundary, true);
  // The real mouse takes its hover back the moment it is used, and the wheel its scroll.
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', (e) => e.isTrusted && mouseBack(e), { capture: true, passive: true });
  window.addEventListener('wheel', (e) => e.isTrusted && mouseBack(e), { capture: true, passive: true });
  window.addEventListener('wheel', cancelGlides, { passive: true });
}
