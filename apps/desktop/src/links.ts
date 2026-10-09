/**
 * `comical://` links — the scheme `app.json` gives the phone apps — opened in the desktop app.
 * `add-registry.tsx`'s web page hands off through it, which is what a README's "add this
 * registry" link lands on.
 */
import { app } from "electron";

const SCHEME = "comical";

/** A dev run is a bare Electron, which isn't something a link should launch. */
export function registerLinkScheme(): void {
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
}

/** The app route a link names, the way expo-router reads its own scheme: `comical://add-registry?url=…`
 *  is `/add-registry?url=…`. The fragment rides along: an implicit OAuth grant arrives there.
 *
 *  Windows canonicalizes a link on its way to the handler — `comical://oauth-callback?code=…` is
 *  handed over as `comical://oauth-callback/?code=…` — so the path's trailing slash is dropped:
 *  no route of ours ends in one, and the sign-in rows match their return on the exact route. */
export function linkRoute(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:`) return null;
  const path = (url.host + url.pathname).replace(/^\/+/, "").replace(/\/+$/, "");
  return `/${path}${url.search}${url.hash}`;
}

/** Windows and Linux hand a link over as a command-line argument — to the first instance when it
 *  launches the app, to `second-instance` when it's already running. */
export function linkInArgs(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const route = arg.startsWith(`${SCHEME}:`) ? linkRoute(arg) : null;
    if (route) return route;
  }
  return null;
}
