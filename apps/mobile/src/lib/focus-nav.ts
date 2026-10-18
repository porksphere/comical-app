import { Platform } from 'react-native';

import { nextInDirection, type Direction, type Rect } from '@/lib/focus-geometry';
import { isTypingTarget } from '@/lib/key-hold';
import { isKey, moveDirectionOf, readerScopeActive } from '@/lib/keybindings';
import { largestScroller } from '@/lib/keyboard-scroll';

// Spatial focus for the desktop's `lists` keys (lib/keymap). Once the keyboard holds the focus —
// Tab, or Space with nothing focused — the move keys carry it to the nearest control in that
// direction instead of scrolling, Space presses it and R opens its menu. A pointer press hands the
// keys back to scrolling (the `data-input` latch in app/+html).
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

const pointerMode = () => document.documentElement.getAttribute('data-input') === 'pointer';

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

/** What a move along that axis stays inside while it can: the scroller it runs through, or a region
 *  (`data-focus-region`) that holds a set of controls apart, like the sidebar. */
function regionOf(el: Element, horizontal: boolean): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (scrolls(p, horizontal) || p.hasAttribute('data-focus-region')) return p;
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
function nearest(from: Rect, self: HTMLElement | null, dir: Direction, anchor: number, region: HTMLElement | null) {
  const pool = candidates().filter(
    (el) => !(self && (el.contains(self) || self.contains(el))) && (region ? region.contains(el) : onTop(el)),
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
// a heading or a shorter row rather than drifting toward whatever each one puts closest.
let anchor: { el: HTMLElement; horizontal: boolean; at: number } | null = null;

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
  el.focus({ focusVisible: true } as FocusOptions);
  requestAnimationFrame(() => uncover(el));
}

const UNCOVER_MARGIN = 8;
const EDGE_PROBE = 2;

/** Scrolls a control out from under whatever is drawn over its list — the top bar, a pinned heading,
 *  the tab bar — which focusing it doesn't do, since it is inside the scroller's view all along. */
function uncover(el: HTMLElement, tries = 2): void {
  const scroller = regionOf(el, false);
  if (!scroller || !el.isConnected || document.activeElement !== el) return;
  const r = el.getBoundingClientRect();
  const x = (r.left + r.right) / 2;
  const coverAt = (y: number) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit || el.contains(hit)) return null;
    let cover: Element = hit;
    while (cover.parentElement && !cover.parentElement.contains(el)) cover = cover.parentElement;
    return cover.getBoundingClientRect();
  };
  const over = coverAt(Math.max(r.top, 0) + EDGE_PROBE);
  const under = over ? null : coverAt(Math.min(r.bottom, window.innerHeight) - EDGE_PROBE);
  if (!over && !under) return;
  scroller.scrollBy({ top: over ? r.top - over.bottom - UNCOVER_MARGIN : r.bottom - under!.top + UNCOVER_MARGIN });
  // What covers it can change with the scroll: a pinned heading hands over to the next section's.
  if (tries > 1) requestAnimationFrame(() => requestAnimationFrame(() => uncover(el, tries - 1)));
}

function move(from: HTMLElement | null, rect: Rect, dir: Direction): void {
  const horizontal = dir.x !== 0;
  const centre = horizontal ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2;
  const at = anchor && anchor.el === from && anchor.horizontal === horizontal ? anchor.at : centre;
  const land = (to: HTMLElement) => {
    focusKeyboard(to);
    anchor = { el: to, horizontal, at };
  };
  const origin = from ?? document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
  const region = origin && regionOf(origin, horizontal);
  const inside = region && nearest(rect, from, dir, at, region);
  if (inside) return land(inside);
  if (!region || !canScroll(region, dir)) {
    const outside = nearest(rect, from, dir, at, null);
    if (outside) land(outside);
    return;
  }
  const step = (horizontal ? region.clientWidth : region.clientHeight) / 2;
  region.scrollBy({ [horizontal ? 'left' : 'top']: (horizontal ? dir.x : dir.y) * step });
  // Two frames: the scroll event, then the list rendering what it scrolled into.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (from && !from.isConnected) return;
      const next = nearest(from?.getBoundingClientRect() ?? rect, from, dir, at, region);
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

function hoverTo(next: HTMLElement | null): void {
  const prev = hovered?.isConnected ? hovered : null;
  hovered = next;
  if (prev === next) return;
  const left = lineage(prev);
  const entered = lineage(next);
  if (prev) {
    prev.removeAttribute('data-key-tint');
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

/** Where the keyboard comes in: the first thing in the screen's main list, else anything on top. */
function focusFirst(): void {
  const main = largestScroller();
  const onScreen = candidates().filter(onTop);
  const pool = onScreen.filter((el) => main?.contains(el));
  const first = (pool.length ? pool : onScreen)
    .map((el) => [el.getBoundingClientRect(), el] as const)
    .sort(([a], [b]) => a.top * 2 + a.left - (b.top * 2 + b.left))[0];
  if (first) focusKeyboard(first[1]);
}

const pressesItselfOnSpace = (el: HTMLElement) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || readerScopeActive() || isTypingTarget(e.target)) return;
  const dir = moveDirectionOf(e);
  if (dir) {
    const from = keyboardFocus();
    const lost = from ? null : recover();
    if (from) move(from, from.getBoundingClientRect(), dir);
    else if (focusCovered()) enterLayer(heldFocus());
    else if (lost) move(lost.el, lost.rect, dir);
    else return;
    e.preventDefault();
    return;
  }
  if (isKey(e, 'activate')) {
    const active = document.activeElement;
    if (e.key === ' ' && active instanceof HTMLElement && pressesItselfOnSpace(active)) return;
    e.preventDefault();
    if (e.repeat) return;
    const focused = keyboardFocus();
    if (focused) focused.click();
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
  // The real pointer takes its hover back the moment it moves.
  window.addEventListener('pointermove', () => hovered && hoverTo(null), { passive: true });
}
