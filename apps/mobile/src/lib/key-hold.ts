// Held-key movement for the desktop: arrows and WASD drive a per-frame, delta-time velocity rather
// than one step per keydown, so the speed is the same at any frame rate and the OS's uneven
// key-repeat has nothing to stutter on.

/** Pixels per second while a direction is held. */
export const HOLD_SPEED = 900;
/** Moved at once on a press, so a tap that is up before the next frame still moves — the browser's
 *  own arrow-key step. */
const TAP_STEP = 40;

export type KeyDirection = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

export function keyDirection(key: string): KeyDirection | null {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return { x: 0, y: -1 };
    case 'ArrowDown':
    case 's':
    case 'S':
      return { x: 0, y: 1 };
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return { x: -1, y: 0 };
    case 'ArrowRight':
    case 'd':
    case 'D':
      return { x: 1, y: 0 };
    default:
      return null;
  }
}

/** A key event that belongs to something being typed into, not to the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
}

/** Calls `move(dx, dy)` every frame — in pixels, along the held directions — until every key held
 *  through `press` has come back up through `release`. */
export function createKeyHold(move: (dx: number, dy: number) => void) {
  const held = new Map<string, KeyDirection>();
  let rafId: number | null = null;
  let lastT = 0;
  const tick = (t: number) => {
    if (held.size === 0) {
      rafId = null;
      return;
    }
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    let x = 0;
    let y = 0;
    for (const d of held.values()) {
      x += d.x;
      y += d.y;
    }
    if (dt > 0 && (x !== 0 || y !== 0)) move(Math.sign(x) * HOLD_SPEED * dt, Math.sign(y) * HOLD_SPEED * dt);
    rafId = requestAnimationFrame(tick);
  };
  return {
    press(key: string, dir: KeyDirection) {
      const k = key.toLowerCase();
      if (!held.has(k)) move(dir.x * TAP_STEP, dir.y * TAP_STEP);
      held.set(k, dir);
      if (rafId == null) {
        lastT = 0;
        rafId = requestAnimationFrame(tick);
      }
    },
    release(key: string) {
      held.delete(key.toLowerCase());
    },
    clear() {
      held.clear();
    },
    dispose() {
      held.clear();
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
    },
  };
}
