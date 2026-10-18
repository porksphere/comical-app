import { Platform } from 'react-native';

import { directionalScore, type Direction } from '@/lib/focus-geometry';
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  el.blur();
  return true;
}

function scrolls(el: HTMLElement, horizontal: boolean): boolean {
  const style = getComputedStyle(el);
  const overflow = horizontal ? style.overflowX : style.overflowY;
  const room = horizontal ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1;
  return room && (overflow === 'auto' || overflow === 'scroll');
}

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (scrolls(p, false) || scrolls(p, true)) return p;
  return null;
}

/** The scroller around `el` that can still go `dir`'s way. */
function scrollerToward(el: HTMLElement, dir: Direction): HTMLElement | null {
  const horizontal = dir.x !== 0;
  const s = horizontal ? dir.x : dir.y;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!scrolls(p, horizontal)) continue;
    const at = horizontal ? p.scrollLeft : p.scrollTop;
    const end = horizontal ? p.scrollWidth - p.clientWidth : p.scrollHeight - p.clientHeight;
    if (s > 0 ? at < end - 1 : at > 1) return p;
  }
  return null;
}

function candidates(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"], [inert]');
  });
}

/** Off screen still counts inside the same scroller as the focus: focusing it scrolls it in. */
function nearest(from: HTMLElement, dir: Direction): HTMLElement | null {
  const rect = from.getBoundingClientRect();
  const home = scrollerOf(from);
  const scored: [number, HTMLElement][] = [];
  for (const el of candidates()) {
    if (el === from || el.contains(from)) continue;
    const score = directionalScore(rect, el.getBoundingClientRect(), dir);
    if (score !== null) scored.push([score, el]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.find(([, el]) => onTop(el) || (!!home && scrollerOf(el) === home))?.[1] ?? null;
}

function focusKeyboard(el: HTMLElement): void {
  document.documentElement.removeAttribute('data-input');
  el.focus({ focusVisible: true } as FocusOptions);
}

function move(from: HTMLElement, dir: Direction): void {
  const to = nearest(from, dir);
  if (to) return focusKeyboard(to);
  const scroller = scrollerToward(from, dir);
  if (!scroller) return;
  const horizontal = dir.x !== 0;
  const step = (horizontal ? scroller.clientWidth : scroller.clientHeight) / 2;
  scroller.scrollBy({ [horizontal ? 'left' : 'top']: (horizontal ? dir.x : dir.y) * step });
  // Two frames: the scroll event, then the list rendering what it scrolled into.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const next = from.isConnected ? nearest(from, dir) : null;
      if (next) focusKeyboard(next);
    }),
  );
}

/** Where the keyboard comes in: the first thing in the screen's main list, else anything on top. */
function focusFirst(): void {
  const main = largestScroller();
  const onScreen = candidates().filter((el) => !isTypingTarget(el) && onTop(el));
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
    if (from) move(from, dir);
    else if (focusCovered()) enterLayer(heldFocus());
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
  // A menu closes itself on Escape and takes the focus with it.
  document.addEventListener('focusout', (e) => {
    if (returnTo && !e.relatedTarget) returnSoon();
  });
}
