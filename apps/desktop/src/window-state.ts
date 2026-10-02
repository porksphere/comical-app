/**
 * The window's size, position and maximized state, carried from one session to the next.
 */
import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type WindowState = { bounds: Rectangle | null; maximized: boolean };

const file = (): string => join(app.getPath("userData"), "comical", "window-state.json");

/** How much of the window's top strip has to land on a display for the saved spot to be usable:
 *  enough to grab it by. */
const GRAB_PX = { width: 120, height: 40 };

function reachable(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const width = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    return width >= GRAB_PX.width && b.y >= a.y && b.y + GRAB_PX.height <= a.y + a.height;
  });
}

export function savedWindowState(): WindowState {
  let raw: { bounds?: Partial<Rectangle>; maximized?: unknown } = {};
  try {
    raw = JSON.parse(readFileSync(file(), "utf8")) as typeof raw;
  } catch {
    // First launch, or a file that doesn't parse: the default size, centred.
  }
  const b = raw.bounds;
  const bounds =
    b && [b.x, b.y, b.width, b.height].every((n) => typeof n === "number" && Number.isFinite(n))
      ? (b as Rectangle)
      : null;
  // A monitor unplugged since would otherwise reopen the window somewhere nobody can reach it.
  return { bounds: bounds && reachable(bounds) ? bounds : null, maximized: raw.maximized === true };
}

export function trackWindowState(win: BrowserWindow): void {
  const write = () => {
    if (win.isDestroyed()) return;
    // The normal bounds, not the current ones: a maximized window restores to where it was.
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      mkdirSync(dirname(file()), { recursive: true });
      writeFileSync(file(), JSON.stringify(state));
    } catch (err) {
      console.error("[window-state] save failed:", err);
    }
  };
  let pending: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(write, 500);
  };
  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  // Synchronous, because a quit doesn't wait for a timer.
  win.on("close", () => {
    if (pending) clearTimeout(pending);
    write();
  });
}
