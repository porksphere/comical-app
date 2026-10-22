/**
 * A bridge's in-app sign-in (a `web-login` setting): the site's own sign-in page in a window of its
 * own, watched until the cookies that mean "signed in" are set, which the page then stores. Each
 * sign-in gets a fresh in-memory session, so it starts signed out — signing in as someone else
 * just works — and nothing it sets reaches the app's own session, or outlives the window.
 */
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, ipcMain, session } from "electron";

type WebLogin = { url: string; cookies: string[]; cookieUrls: string[] };

export function registerWebLogin(mainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("web-login", (e, raw: unknown) => {
    const parent = mainWindow();
    if (!parent || e.sender !== parent.webContents) throw new Error("web-login from another window");
    const login = parseLogin(raw);
    if (!login) throw new Error("not a web-login request");
    return signIn(login, parent);
  });
}

function parseLogin(raw: unknown): WebLogin | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { url, cookies, cookieUrls } = raw as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : null);
  const names = strings(cookies);
  const extra = strings(cookieUrls ?? []);
  if (typeof url !== "string" || !names?.length || !extra || ![url, ...extra].every(isWebUrl)) return null;
  return { url, cookies: names, cookieUrls: extra };
}

function isWebUrl(url: string): boolean {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Resolves to the collected `Cookie` string, or null when the user closes the window first. */
function signIn(login: WebLogin, parent: BrowserWindow): Promise<string | null> {
  const ses = session.fromPartition(`web-login-${randomUUID()}`);
  // Sign-in pages behind a bot check turn away a browser that names itself something unusual.
  ses.setUserAgent(app.userAgentFallback.replace(/ (?!Chrome\/|Safari\/|AppleWebKit\/)[^\s()/]+\/\S+/g, ""));
  const win = new BrowserWindow({
    parent,
    width: 520,
    height: 720,
    title: "Sign in",
    autoHideMenuBar: true,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      ses.cookies.off("changed", onChanged);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };
    const onChanged = () => {
      void collect(ses, login).then((header) => {
        if (header) finish(header);
      });
    };
    ses.cookies.on("changed", onChanged);
    win.on("closed", () => finish(null));
    // A sign-in that opens a popup (a provider's own page) carries on in this window instead.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void win.loadURL(url);
      return { action: "deny" };
    });
    void win.loadURL(login.url);
  });
}

/** Every cookie set for the sign-in's sites, once all the required ones are among them. */
async function collect(ses: Electron.Session, login: WebLogin): Promise<string | null> {
  const jar = new Map<string, string>();
  for (const url of [login.url, ...login.cookieUrls]) {
    for (const c of await ses.cookies.get({ url })) if (!jar.has(c.name)) jar.set(c.name, c.value);
  }
  if (!login.cookies.every((name) => jar.get(name))) return null;
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}
