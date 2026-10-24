// Held-key movement for the desktop: the move keys (lib/keymap — WASD and the arrows) drive a per-frame, delta-time velocity rather
// than one step per keydown, so the speed is the same at any frame rate and the OS's uneven
// key-repeat has nothing to stutter on. The velocity EASES toward the held speed and glides back to
// rest after release, and a fresh press starts from a kick rather than from nothing — so a quick tap
// still moves about the browser's own arrow step, without the jump that step is.

import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

/** Pixels per second while a direction is held, at the default `keyPanSpeed`. */
export const HOLD_SPEED = 900;

/** The range every keyboard speed setting runs over, as a multiple of its default pace. */
export const KEY_SPEED_MIN = 0.25;
export const KEY_SPEED_MAX = 3;
export const KEY_SPEED_STEP = 0.25;
const KEY_SPEED_DEFAULT = 1;

/** A persisted keyboard speed under `key`: read (`get`, outside React), subscribe (`use`) and set,
 *  each clamped to the range above (a stored value out of it, or not a number, reads as the default). */
export function keySpeedStore(key: string) {
  const store$ = persisted$<number>(key, KEY_SPEED_DEFAULT);
  const clampSpeed = (v: unknown) =>
    Number.isFinite(v) ? Math.min(KEY_SPEED_MAX, Math.max(KEY_SPEED_MIN, v as number)) : KEY_SPEED_DEFAULT;
  return {
    get: () => clampSpeed(store$.peek()),
    use: () => clampSpeed(use$(store$)),
    set: (speed: number) => store$.set(clampSpeed(speed)),
  };
}

/** How fast the KEYBOARD pans — the move keys held — as a multiple of HOLD_SPEED. A tap's step
 *  scales with it too, so the hand that likes a fast hold isn't left with a slow tap. The mouse,
 *  the wheel and a touch don't read it. */
const panSpeed = keySpeedStore('comical:keyPanSpeed');
export const keyPanSpeed = panSpeed.get;
export const useKeyPanSpeed = panSpeed.use;
export const setKeyPanSpeed = panSpeed.set;
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
 *  through `press` has come back up through `release` and the glide that follows has died out.
 *  `speed` multiplies the held speed and the kick, read at each press and frame so a change to the
 *  setting takes mid-hold; without it the hold runs at the one pace (the zoom's, which scales its
 *  own rate off the distance). */
export function createKeyHold(move: (dx: number, dy: number) => void, speed: () => number = () => 1) {
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
    const top = HOLD_SPEED * speed();
    vx = ease(vx, Math.sign(x) * top, dt);
    vy = ease(vy, Math.sign(y) * top, dt);
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
        const kick = KICK_SPEED * speed();
        if (dir.x !== 0 && vx * dir.x < kick) vx = dir.x * kick;
        if (dir.y !== 0 && vy * dir.y < kick) vy = dir.y * kick;
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
