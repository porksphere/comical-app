/**
 * A web check (the app's `data/web-check.ts`): a site answered a bridge with an anti-bot check, so
 * its page opens in a window of its own on a fresh session, with the challenged request's own
 * User-Agent (the clearance a site hands out is tied to it). The window starts hidden, so a check
 * that needs no person passes on its own; it is shown when the page asks for one, or after a few
 * seconds. Once a clearance cookie appears, the site's cookies go back, with their domains and
 * expiry, to be imported into the bridge's cookie jar. A check that names page storage keys is
 * done once they're all set in the page's localStorage instead (the session is fresh, so anything
 * there is new), and their values go back too.
 */
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { needsOverride, platformUserAgent } from "./user-agent.ts";

type WebCheck = { url: string; userAgent?: string; storage?: string[]; quiet?: boolean };
type Result = { cookies: Cookie[]; userAgent: string; values?: Record<string, string> };
type Cookie = { name: string; value: string; domain?: string; path?: string; expires?: number };

const CLEARANCE = ["cf_clearance", "__ddg1_", "__ddg2_", "__ddgid_", "__ddgmark_", "__ddg8_", "__ddg9_", "__ddg10_", "waf_pass", "__guard_trust"];
const HIDDEN_MS = 7000;
const QUIET_MS = 15000;
const POLL_MS = 1000;
// Cloudflare's challenge reports its progress to the page with `postMessage`; `interactiveBegin`
// means it is waiting on a person (the signal the phone and Mihon read too; a check that passes by
// itself never sends it). The widget sits in a closed shadow root, so it can't be found in the DOM.
const LISTEN = `if (!window.__comicalCheck) { window.__comicalCheck = { asks: false }; addEventListener("message", function (e) { var d = e && e.data; if (d && d.source === "cloudflare-challenge" && d.event === "interactiveBegin") window.__comicalCheck.asks = true; }); } true;`;
const ASKS_FOR_A_PERSON = `!!(window.__comicalCheck && window.__comicalCheck.asks)`;

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
  const { url, userAgent, storage, quiet } = raw as Record<string, unknown>;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  if (userAgent !== undefined && (typeof userAgent !== "string" || !userAgent)) return null;
  if (storage !== undefined && !(Array.isArray(storage) && storage.length <= 20 && storage.every((k) => typeof k === "string" && k && k.length <= 256))) return null;
  return {
    url,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
    ...(Array.isArray(storage) && storage.length ? { storage: storage as string[] } : {}),
    ...(quiet === true ? { quiet: true } : {}),
  };
}

/** Reads `keys` from the page's localStorage, as a JSON string of the ones set. */
function storageRead(keys: readonly string[]): string {
  return `(function () { var o = {}; try { ${JSON.stringify(keys)}.forEach(function (k) { var v = localStorage.getItem(k); if (v) o[k] = v; }); } catch (e) {} return JSON.stringify(o); })()`;
}

function runCheck(check: WebCheck, parent: BrowserWindow): Promise<Result | null> {
  const keys = check.storage ?? [];
  const ses = session.fromPartition(`web-check-${randomUUID()}`);
  // Left untouched unless the bridge asked for another User-Agent: an override costs the client
  // hints, and the check then never passes (see user-agent.ts).
  const platform = platformUserAgent(app.userAgentFallback);
  if (needsOverride(check.userAgent, platform)) ses.setUserAgent(check.userAgent);
  const userAgent = check.userAgent ?? platform;
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
    // A quiet check is never shown: where it would be, it gives up and waits for the person.
    const reveal = () => {
      if (check.quiet) return finish(null);
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    };
    const finish = (value: Result | null) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(show);
      ses.cookies.off("changed", onChanged);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };
    const through = (values?: Record<string, string>) =>
      void ses.cookies.get({ url: check.url }).then((all) => finish({ cookies: all.map(toImport), userAgent, ...(values ? { values } : {}) }));
    const onChanged = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      // With storage keys to wait for, a clearance cookie is only a step on the way.
      if (keys.length || removed || !CLEARANCE.includes(cookie.name) || !cookie.value) return;
      through();
    };
    ses.cookies.on("changed", onChanged);
    const show = setTimeout(reveal, check.quiet ? QUIET_MS : HIDDEN_MS);
    const poll = setInterval(() => {
      if (win.isDestroyed()) return;
      if (keys.length) {
        void win.webContents.executeJavaScript(storageRead(keys), false).then((raw: unknown) => {
          const values = parseValues(raw);
          if (keys.every((k) => values[k])) through(values);
        }, () => {});
      }
      if (!win.isVisible()) void win.webContents.executeJavaScript(ASKS_FOR_A_PERSON, false).then((asks) => asks && reveal(), () => {});
    }, POLL_MS);
    win.on("closed", () => finish(null));
    win.webContents.on("dom-ready", () => void win.webContents.executeJavaScript(LISTEN, false).catch(() => {}));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    void win.loadURL(check.url);
  });
}

function parseValues(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const obj = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (typeof obj === "object" && obj !== null) for (const [k, v] of Object.entries(obj)) if (typeof v === "string" && v) out[k] = v;
  } catch {
    // Not a report.
  }
  return out;
}

function toImport(c: Electron.Cookie): Cookie {
  const out: Cookie = { name: c.name, value: c.value, path: c.path ?? "/" };
  // A host-only cookie has no domain to name; the host scopes it to the check's own host.
  if (c.domain && !c.hostOnly) out.domain = c.domain.replace(/^\./, "");
  if (c.expirationDate) out.expires = Math.round(c.expirationDate * 1000);
  return out;
}
