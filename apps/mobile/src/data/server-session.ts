/**
 * The one signed-in server session — a Legend State observable (see `lib/observable.ts`), per the
 * app's local-state convention. Read in a component with `useServerSession()`, or outside React with
 * `getServerSession()`.
 *
 * A single server backs BOTH remote browsing and cross-device sync (they are always the same host),
 * so there is one session shared by both: `loginToServer` trades a username + password at the hub's
 * `POST /login` for a per-device **session token** that then authenticates every request — the remote
 * transport attaches it as `Authorization: Bearer` (see `api.ts`), and the sync controller uses it for
 * `/sync`. The token is server-stored and revocable; login just mints it. This replaces the old QR
 * device-enrollment flow.
 *
 * The token is this device's own secret on this device — the same trust level as a saved password —
 * and is only ever sent back to the server it was minted by (see `bearerFor`).
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { persisted$ } from '@/lib/observable';

export type ServerSession = {
  /** The hub this session belongs to (normalized, no trailing slash). Empty = not signed in. */
  url: string;
  /** The account name that was logged in (for display; the server derives the real account). */
  username: string;
  /** The per-device session token minted at login. Revocable server-side; carried as Bearer. */
  token: string;
  /** The shared sync account id the server returned. Keys the local pull cursor + bootstrap. */
  account: string;
  /** The server's stable identity (from the login response). Lets sync spot a different server at
   *  the same address instead of erroring in a loop. */
  serverId: string;
};

const KEY = 'comical:serverSession';
const DEFAULT: ServerSession = { url: '', username: '', token: '', account: '', serverId: '' };

const session$ = persisted$<ServerSession>(KEY, DEFAULT);

/**
 * Normalize a user-typed server address: default the scheme to `http://` when none was given (so
 * `192.168.1.10:3100` works, not just `http://192.168.1.10:3100`) and drop any trailing slash. Empty
 * in → empty out.
 */
export function normalizeServerUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
  return withScheme.replace(/\/+$/, '');
}

/** Non-React read (spread over defaults so a blob persisted before a field existed still has it). */
export function getServerSession(): ServerSession {
  return { ...DEFAULT, ...session$.peek() };
}

/** React read of the current session. */
export function useServerSession(): ServerSession {
  return { ...DEFAULT, ...use$(session$) };
}

/** True once a login has supplied a server, token, and account. */
export function isSignedIn(s: ServerSession = getServerSession()): boolean {
  return s.url.length > 0 && s.token.length > 0 && s.account.length > 0;
}

/**
 * The bearer token to attach to a request bound for `url`, or '' if this device isn't signed in to
 * that exact server. Guards against ever sending the token to a *different* host (e.g. after the user
 * edits the remote-server URL without logging in there) — the token only means anything to the server
 * that minted it.
 */
export function bearerFor(url: string): string {
  const s = session$.peek() as Partial<ServerSession>;
  if (!s.url || !s.token) return '';
  return normalizeServerUrl(s.url) === normalizeServerUrl(url) ? s.token : '';
}

/** Forget the local session (does not revoke it server-side — callers do that first if online). */
export function clearServerSession(): void {
  session$.set(DEFAULT);
}

/** A human label for this device, sent to the hub so `comical sessions list` is readable. */
function deviceName(): string {
  return Device.deviceName || `${Device.modelName ?? Platform.OS} device`;
}

export type LoginResult = { ok: true; session: ServerSession } | { ok: false; error: string };

/**
 * Log in to `url` with `username`/`password`. On success, persist the session (token + account +
 * serverId) and return it; the caller wires the side effects (clear the query cache, refresh sync).
 */
export async function loginToServer(url: string, username: string, password: string): Promise<LoginResult> {
  const base = normalizeServerUrl(url);
  if (!base) return { ok: false, error: 'Enter the server address first.' };
  let res: Response;
  try {
    res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name: deviceName() }),
    });
  } catch {
    return { ok: false, error: `Couldn’t reach ${base}. Same network as the server?` };
  }
  if (res.status === 401) return { ok: false, error: 'Wrong username or password.' };
  if (res.status === 429) return { ok: false, error: 'Too many attempts — wait a few minutes and try again.' };
  if (res.status === 404) return { ok: false, error: 'This server doesn’t have accounts enabled.' };
  if (!res.ok) return { ok: false, error: `Login failed (${res.status}).` };

  const body = (await res.json().catch(() => ({}))) as { token?: string; account?: string; serverId?: string };
  if (!body.token || !body.account) return { ok: false, error: 'The server sent an unexpected response.' };

  const session: ServerSession = {
    url: base,
    username,
    token: body.token,
    account: body.account,
    serverId: body.serverId ?? '',
  };
  session$.set(session);
  return { ok: true, session };
}

/**
 * Best-effort server-side logout: revoke this device's own session token (`DELETE /sync/self`), then
 * forget it locally regardless — the device may be offline, but the user still wants it gone here.
 */
export async function logoutFromServer(): Promise<void> {
  const s = getServerSession();
  if (s.url && s.token) {
    await fetch(`${s.url}/sync/self`, { method: 'DELETE', headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {});
  }
  clearServerSession();
}
