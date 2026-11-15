/**
 * A web check (the app's `data/web-check.ts`): a site answered a bridge with an anti-bot check, so
 * its page opens in a window of its own on a fresh session, with the challenged request's own
 * User-Agent (the clearance a site hands out is tied to it). The window starts hidden, so a check
 * that needs no person passes on its own; it is shown when the page asks for one, or after a few
 * seconds. Once a clearance cookie appears, the site's cookies go back, with their domains and
 * expiry, to be imported into the bridge's cookie jar.
 */
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, ipcMain, session } from "electron";

type WebCheck = { url: string; userAgent?: string };
type Cookie = { name: string; value: string; domain?: string; path?: string; expires?: number };

const CLEARANCE = ["cf_clearance", "__ddg1_", "__ddg2_", "__ddgid_", "__ddgmark_", "__ddg8_", "__ddg9_", "__ddg10_", "waf_pass"];
const HIDDEN_MS = 7000;
const POLL_MS = 1000;
// What a check waiting on a person puts on the page: Cloudflare's Turnstile frame.
const ASKS_FOR_A_PERSON = `!!document.querySelector('iframe[src*="challenges.cloudflare.com"]')`;

export function registerWebCheck(mainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("web-check", (e, raw: unknown) => {
    const parent = mainWindow();
    if (!parent || e.sender !== parent.webContents) throw new Error("web-check from another window");
    const check = parseCheck(raw);
    if (!check) throw new Error("not a web-check request");
    return runCheck(check, parent);
  });
}

function parseCheck(raw: unknown): WebCheck | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { url, userAgent } = raw as Record<string, unknown>;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  if (userAgent !== undefined && (typeof userAgent !== "string" || !userAgent)) return null;
  return typeof userAgent === "string" ? { url, userAgent } : { url };
}

function runCheck(check: WebCheck, parent: BrowserWindow): Promise<{ cookies: Cookie[]; userAgent: string } | null> {
  const ses = session.fromPartition(`web-check-${randomUUID()}`);
  const userAgent = check.userAgent ?? app.userAgentFallback.replace(/ (?!Chrome\/|Safari\/|AppleWebKit\/)[^\s()/]+\/\S+/g, "");
  ses.setUserAgent(userAgent);
  const win = new BrowserWindow({
    parent,
    show: false,
    width: 520,
    height: 720,
    title: new URL(check.url).hostname,
    autoHideMenuBar: true,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  return new Promise((resolve) => {
    let settled = false;
    const reveal = () => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    };
    const finish = (value: { cookies: Cookie[]; userAgent: string } | null) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(show);
      ses.cookies.off("changed", onChanged);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };
    const onChanged = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      if (removed || !CLEARANCE.includes(cookie.name) || !cookie.value) return;
      void ses.cookies.get({ url: check.url }).then((all) => finish({ cookies: all.map(toImport), userAgent }));
    };
    ses.cookies.on("changed", onChanged);
    const show = setTimeout(reveal, HIDDEN_MS);
    const poll = setInterval(() => {
      if (win.isDestroyed() || win.isVisible()) return;
      void win.webContents.executeJavaScript(ASKS_FOR_A_PERSON, false).then((asks) => asks && reveal(), () => {});
    }, POLL_MS);
    win.on("closed", () => finish(null));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    void win.loadURL(check.url);
  });
}

function toImport(c: Electron.Cookie): Cookie {
  const out: Cookie = { name: c.name, value: c.value, path: c.path ?? "/" };
  // A host-only cookie has no domain to name; the host scopes it to the check's own host.
  if (c.domain && !c.hostOnly) out.domain = c.domain.replace(/^\./, "");
  if (c.expirationDate) out.expires = Math.round(c.expirationDate * 1000);
  return out;
}
