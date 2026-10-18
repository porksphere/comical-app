// Held-key movement for the desktop: the move keys (lib/keymap — WASD and the arrows) drive a per-frame, delta-time velocity rather
// than one step per keydown, so the speed is the same at any frame rate and the OS's uneven
// key-repeat has nothing to stutter on. The velocity EASES toward the held speed and glides back to
// rest after release, and a fresh press starts from a kick rather than from nothing — so a quick tap
// still moves about the browser's own arrow step, without the jump that step is.

/** Pixels per second while a direction is held. */
export const HOLD_SPEED = 900;
/** The velocity a fresh press starts from, so a tap that is up before the ease-in gets going still
 *  travels (about KICK_SPEED · GLIDE_S). */
const KICK_SPEED = 600;
/** Time constants, in seconds: of the ease toward HOLD_SPEED, and of the glide after release. */
const EASE_IN_S = 0.05;
const GLIDE_S = 0.07;
/** Below this the glide has stopped. */
const REST_SPEED = 8;

/** How much of a screen Space scrolls a page that runs on below it, leaving a strip of what was
 *  read to keep the place by. */
export const PAGE_KEY_SCROLL = 0.85;

export type KeyDirection = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/** A key event that belongs to something being typed into, not to the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
}

/** A key event aimed at a focused control, whose own Space presses it. */
export function isControlTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && el !== document.body && typeof el.tabIndex === 'number' && el.tabIndex >= 0;
}

/** Calls `move(dx, dy)` every frame — in pixels, along the held directions — until every key held
 *  through `press` has come back up through `release` and the glide that follows has died out. */
export function createKeyHold(move: (dx: number, dy: number) => void) {
  const held = new Map<string, KeyDirection>();
  let vx = 0;
  let vy = 0;
  let rafId: number | null = null;
  let lastT = 0;
  const ease = (v: number, want: number, dt: number) =>
    v + (want - v) * (1 - Math.exp(-dt / (want !== 0 ? EASE_IN_S : GLIDE_S)));
  const tick = (t: number) => {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    let x = 0;
    let y = 0;
    for (const d of held.values()) {
      x += d.x;
      y += d.y;
    }
    vx = ease(vx, Math.sign(x) * HOLD_SPEED, dt);
    vy = ease(vy, Math.sign(y) * HOLD_SPEED, dt);
    if (held.size === 0 && Math.abs(vx) < REST_SPEED && Math.abs(vy) < REST_SPEED) {
      vx = vy = 0;
      rafId = null;
      return;
    }
    if (dt > 0) move(vx * dt, vy * dt);
    rafId = requestAnimationFrame(tick);
  };
  const stop = () => {
    held.clear();
    vx = vy = 0;
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
  };
  return {
    press(key: string, dir: KeyDirection) {
      const k = key.toLowerCase();
      if (!held.has(k)) {
        if (dir.x !== 0 && vx * dir.x < KICK_SPEED) vx = dir.x * KICK_SPEED;
        if (dir.y !== 0 && vy * dir.y < KICK_SPEED) vy = dir.y * KICK_SPEED;
      }
      held.set(k, dir);
      if (rafId == null) {
        lastT = 0;
        rafId = requestAnimationFrame(tick);
      }
    },
    release(key: string) {
      held.delete(key.toLowerCase());
    },
    /** Lets go of every key; what is moving glides to a stop. */
    clear() {
      held.clear();
    },
    /** Stops dead — for a move that no longer has anywhere to land, such as a page just turned. */
    stop,
    dispose: stop,
  };
}
