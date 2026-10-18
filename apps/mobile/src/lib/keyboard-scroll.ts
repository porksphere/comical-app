import { Platform } from 'react-native';

import { createKeyHold, isTypingTarget } from '@/lib/key-hold';
import { moveDirectionOf } from '@/lib/keybindings';

// Up/Down (lib/keymap — W/S and ↑/↓) scroll the app's screens on a desktop. With body scroll locked app-wide, every list is
// its own scroller, and the browser only arrow-scrolls one that has been clicked into — so this
// scrolls the one under the pointer, or, with the pointer elsewhere, the largest one on screen.
// The readers claim their own keys first (in the capture phase), so they never reach here.

function scrollsY(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const overflow = getComputedStyle(el).overflowY;
  return overflow === 'auto' || overflow === 'scroll';
}

function scrollerAt(x: number, y: number): HTMLElement | null {
  for (let el = document.elementFromPoint(x, y) as HTMLElement | null; el; el = el.parentElement) {
    if (scrollsY(el)) return el;
  }
  return null;
}

function largestScroller(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll<HTMLElement>('div')) {
    if (!scrollsY(el)) continue;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0)) *
      Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

export function installKeyboardScroll(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  let pointer: { x: number; y: number } | null = null;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') pointer = { x: e.clientX, y: e.clientY };
  }, { passive: true });

  let target: HTMLElement | null = null;
  const hold = createKeyHold((_dx, dy) => {
    if (target?.isConnected) target.scrollTop += dy;
  });

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || isTypingTarget(e.target)) return;
    const dir = moveDirectionOf(e);
    if (!dir || dir.y === 0) return;
    if (!e.repeat || !target?.isConnected) {
      target = (pointer && scrollerAt(pointer.x, pointer.y)) || largestScroller();
    }
    if (!target) return;
    e.preventDefault();
    hold.press(e.key, dir);
  });
  window.addEventListener('keyup', (e) => hold.release(e.key));
  window.addEventListener('blur', () => hold.clear());
}
