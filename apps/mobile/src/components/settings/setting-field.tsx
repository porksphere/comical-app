import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { openAuthSessionAsync, openBrowserAsync } from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import type { SettingsField, SettingsOption } from '@/components/settings/settings-form';
import { canSignInNatively, WebLoginSheet } from '@/components/settings/web-login-sheet';
import {
  completeOAuthCallback,
  type OAuthReturnTo,
  type SettingDescriptor,
  type SettingValue,
  type WebLoginSetting,
} from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { desktopShell } from '@/lib/desktop-shell';
import { awaitOAuthReturn, parseOAuthReturn, type OAuthReturn } from '@/lib/oauth-return';
import { testId } from '@/lib/test-id';

/** Whether a descriptor persists itself the moment it's interacted with, so the settings screen
 *  needs no Save button for it: `oauth-callback` (server finishes the exchange and stores it) and an
 *  implicit-capture `oauth-pin` (Connect auto-commits). A paste-style oauth-pin or any typed field
 *  still stages and needs Save. */
export function isAutoPersistedField(d: SettingDescriptor): boolean {
  if (d.type === 'oauth-callback') return true;
  if (d.type === 'oauth-pin') return isImplicitCapture(d);
  if (d.type === 'web-login') return canSignInHere();
  return false;
}

/** Label with a trailing `*` for a required field. */
const fieldLabel = (d: SettingDescriptor): string => `${d.label}${'required' in d && d.required ? ' *' : ''}`;

/** What a sign-in row is up to: in flight, failed, or just captured (and so connected before the
 *  server says so). */
type RowState = { busy?: boolean; error?: string | null; captured?: boolean };

/**
 * A bridge's or tracker's `SettingDescriptor`s as settings fields (`settings-form.ts`), one or two
 * per descriptor (`fieldsFor`), for its screen's sections: string/number as a text row (a bounded number a
 * stepper), boolean a toggle, an enum a select (several at once, a checklist), and the sign-ins —
 * `oauth-pin`, `oauth-callback`, `web-login` — as action rows whose verb starts the round trip,
 * with the state of each sign-in kept here by its key. `extras` is what a screen must render
 * beside the list for those: the in-app sign-in sheet.
 *
 * `valueOf` is the current value by key (an edit over the loaded value); `secretSet` whether the
 * server holds a value for a secret it never sends. A sign-in persists at once through `onCommit`
 * where the screen gives one (tracker settings): signing in is the save. Without it (a bridge, a
 * paste) the value stages through `onChange` for the screen's Save, like any typed field.
 */
export function useDescriptorFields({
  valueOf,
  secretSet,
  trackerId,
  onChange,
  onCommit,
}: {
  valueOf: (key: string) => SettingValue | undefined;
  secretSet: (key: string) => boolean;
  /** The tracker these belong to; an `oauth-callback` round trip starts against it. Bridges never
   *  declare one. */
  trackerId?: string;
  onChange: (key: string, value: SettingValue) => void;
  onCommit?: (key: string, value: SettingValue) => Promise<void>;
}): { fieldsFor: (descriptor: SettingDescriptor) => SettingsField[]; extras: ReactNode } {
  const ds = useDataSource();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [sheet, setSheet] = useState<{ key: string; login: WebLoginSetting } | null>(null);
  const patch = (key: string, state: RowState) => setRows((prev) => ({ ...prev, [key]: { ...prev[key], ...state } }));
  const stateOf = (key: string): RowState => rows[key] ?? {};
  /** One sign-in attempt: busy while it runs, its failure on the row after. */
  const attempt = async (key: string, work: () => Promise<void>, fallback: string) => {
    if (stateOf(key).busy) return;
    patch(key, { busy: true, error: null });
    try {
      await work();
    } catch (e) {
      patch(key, { captured: false, error: e instanceof Error ? e.message : fallback });
    } finally {
      patch(key, { busy: false });
    }
  };
  const store = async (key: string, value: string) => {
    onChange(key, value);
    if (onCommit) await onCommit(key, value);
  };

  const fieldsFor = (d: SettingDescriptor): SettingsField[] => {
    const label = fieldLabel(d);
    const value = valueOf(d.key);
    switch (d.type) {
      case 'string':
        return [
          {
            kind: 'text',
            label,
            description: d.description,
            value: (value as string | undefined) ?? '',
            // A secret reads as a password field: a masked placeholder (whether or not one is
            // already stored — leaving it blank keeps the existing value).
            placeholder: d.secret ? '••••••••' : (d.placeholder ?? 'Type…'),
            secure: !!d.secret,
            onChange: (v) => onChange(d.key, v),
          },
        ];
      case 'number':
        if (d.min !== undefined && d.max !== undefined) {
          const min = d.min;
          return [
            {
              kind: 'stepper',
              label,
              description: d.description,
              value: (value as number | undefined) ?? d.default ?? min,
              min,
              max: d.max,
              onChange: (v) => onChange(d.key, v),
            },
          ];
        }
        return [
          {
            kind: 'text',
            label,
            description: d.description,
            // Sent as a raw string on save — the server's settings validator coerces a numeric string.
            value: value === undefined ? '' : String(value),
            keyboard: 'numeric',
            placeholder: d.default !== undefined ? String(d.default) : undefined,
            onChange: (v) => onChange(d.key, v),
          },
        ];
      case 'boolean':
        return [
          {
            kind: 'toggle',
            label,
            description: d.description,
            value: (value as boolean | undefined) ?? d.default ?? false,
            onChange: (v) => onChange(d.key, v),
          },
        ];
      case 'enum': {
        const options = d.options.map((o): SettingsOption<string> => ({ value: o.value, label: o.label }));
        if (d.multiple) {
          return [
            {
              kind: 'multi',
              label,
              description: d.description,
              value: Array.isArray(value) ? value : [],
              options,
              onChange: (v) => onChange(d.key, v),
            },
          ];
        }
        return [
          {
            kind: 'select',
            label,
            description: d.description,
            value: typeof value === 'string' ? value : typeof d.default === 'string' ? d.default : '',
            options,
            onChange: (v) => onChange(d.key, v),
            placeholder: 'Select…',
          },
        ];
      }
      case 'oauth-pin': {
        const state = stateOf(d.key);
        const set = secretSet(d.key);
        const id = testId('settings.oauth', d.label);
        // An implicit-grant field (`response_type=token`, no `exchange`) is captured automatically —
        // no copy-paste. The provider redirects the token to the relay page, which returns it to the
        // app (see `runOAuthRound`); a `code`-exchange field falls back to open-and-paste.
        if (isImplicitCapture(d)) {
          const connect = () =>
            attempt(
              d.key,
              async () => {
                const r = await runOAuthRound(withParam(d.authUrl, 'state', oauthReturnTo()), 'oauth-token');
                if (!r) return; // user gave up — leave state as-is
                if (r.error) throw new Error(r.error);
                if (!r.token) throw new Error('Sign-in did not return an access token.');
                await store(d.key, r.token);
                patch(d.key, { captured: true });
              },
              'Sign-in failed',
            );
          const connected = set || !!state.captured;
          return [
            {
              kind: 'action',
              testID: id,
              label: d.label,
              description: state.error
                ? state.error
                : state.captured
                  ? onCommit
                    ? 'Connected'
                    : 'Signed in — tap Save to finish'
                  : set
                    ? 'Connected'
                    : (d.description ?? 'Not connected'),
              tone: state.error ? 'danger' : state.captured ? 'info' : connected ? undefined : 'warn',
              verb: connected ? 'Reconnect' : 'Connect',
              busy: !!state.busy,
              onPress: () => void connect(),
            },
          ];
        }
        return [
          {
            kind: 'action',
            testID: id,
            label: d.label,
            description: set ? 'Connected' : (d.description ?? 'Not connected'),
            tone: set ? undefined : 'warn',
            verb: 'Open',
            onPress: () => void openBrowserAsync(d.authUrl),
          },
          {
            kind: 'text',
            label: d.exchange ? 'Authorization code' : 'Access token',
            value: (value as string | undefined) ?? '',
            placeholder: set ? '••••••••' : 'Paste here…',
            secure: true,
            onChange: (v) => onChange(d.key, v),
          },
        ];
      }
      case 'oauth-callback': {
        // No value is ever typed in — the whole exchange happens through a browser round trip. The
        // router builds the auth URL (`oauth-start`) around the hosted relay page, the relay hands
        // the provider's `code` + `state` back, and the exchange is finished through the same
        // transport that started it, where the pending PKCE state lives. No token is ever seen here.
        const state = stateOf(d.key);
        const set = secretSet(d.key);
        const connect = () =>
          attempt(
            d.key,
            async () => {
              if (!trackerId) return;
              const { authUrl } = await ds.startTrackerOAuth(trackerId, d.key, oauthReturnTo());
              const r = await runOAuthRound(authUrl, 'oauth-callback');
              if (!r) return;
              if (r.error) throw new Error(r.error);
              if (!r.code || !r.state) throw new Error('Sign-in did not return an authorization code.');
              await completeOAuthCallback(r.code, r.state);
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.trackerSettings(trackerId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.trackers() }),
              ]);
            },
            'Failed to start sign-in',
          );
        return [
          {
            kind: 'action',
            testID: testId('settings.oauth', d.label),
            label: d.label,
            description: state.error ?? (set ? 'Connected' : (d.description ?? 'Not connected')),
            tone: state.error ? 'danger' : set ? undefined : 'warn',
            verb: set ? 'Reconnect' : 'Connect',
            busy: !!state.busy,
            disabled: !trackerId,
            onPress: () => void connect(),
          },
        ];
      }
      case 'web-login': {
        // The site's own sign-in page, after which the cookies it set are the value. A browser tab
        // can't read another site's cookies, so there it opens the page and takes a paste.
        const state = stateOf(d.key);
        const set = secretSet(d.key);
        const signedIn = set && value !== '';
        if (!canSignInHere()) {
          return [
            {
              kind: 'action',
              testID: testId('settings.web-login.open', d.label),
              label,
              description: signedIn ? 'Signed in' : (d.description ?? 'Not signed in'),
              tone: signedIn ? undefined : 'warn',
              verb: 'Open',
              onPress: () => void openBrowserAsync(d.url),
            },
            {
              kind: 'text',
              label: 'Cookies',
              description: `After signing in, copy ${d.cookies.join(' and ')} from the site's cookies.`,
              value: (value as string | undefined) ?? '',
              placeholder: set ? '••••••••' : 'Paste here…',
              secure: true,
              onChange: (v) => onChange(d.key, v),
            },
          ];
        }
        const signIn = () => {
          const webLogin = desktopShell()?.webLogin;
          if (canSignInNatively || !webLogin) {
            patch(d.key, { error: null });
            setSheet({ key: d.key, login: d });
            return;
          }
          void attempt(
            d.key,
            async () => {
              const cookies = await webLogin({ url: d.url, cookies: d.cookies, cookieUrls: d.cookieUrls ?? [] });
              if (cookies !== null) await store(d.key, cookies);
            },
            'Sign-in failed',
          );
        };
        return [
          {
            kind: 'action',
            testID: testId('settings.web-login', d.label),
            label,
            description: state.error ?? (signedIn ? 'Signed in' : (d.description ?? 'Not signed in')),
            tone: state.error ? 'danger' : signedIn ? undefined : 'warn',
            verb: signedIn ? 'Sign in again' : 'Sign in',
            busy: !!state.busy,
            onPress: signIn,
          },
          ...(onCommit
            ? [
                {
                  kind: 'action' as const,
                  testID: testId('settings.web-login.sign-out', d.label),
                  label: 'Sign out',
                  disabled: !signedIn || !!state.busy,
                  onPress: () => void attempt(d.key, () => store(d.key, ''), 'Sign-out failed'),
                },
              ]
            : []),
        ];
      }
    }
  };

  const extras = (
    <WebLoginSheet
      login={sheet?.login ?? null}
      onDone={(cookies) => {
        const key = sheet?.key;
        setSheet(null);
        if (key && cookies !== null) void attempt(key, () => store(key, cookies), 'Sign-in failed');
      }}
    />
  );
  return { fieldsFor, extras };
}

/** The app itself can watch a sign-in happen: on a phone, or in the desktop shell. A browser tab can't. */
function canSignInHere(): boolean {
  return canSignInNatively || !!desktopShell()?.webLogin;
}

/**
 * Where this client takes the provider's answer back from the relay page
 * (`public/oauth-relay.html`): through its own `comical://` scheme on a phone, where the in-app auth
 * session intercepts the link, and in the desktop shell, which registers the scheme and hands the
 * link in as a command (`lib/oauth-return`); through a popup's opener in a browser tab, which has
 * no scheme to come back on. The relay reads it out of the OAuth `state`.
 */
function oauthReturnTo(): OAuthReturnTo {
  return Platform.OS !== 'web' || desktopShell() ? 'native' : 'web';
}

/**
 * Open the authorize URL and wait for the relay to hand the provider's answer back. `null` when the
 * user gave up — closed the auth session or the popup — so the row stays as it was. On web this must
 * run from a user gesture or the browser blocks the popup.
 */
async function runOAuthRound(authUrl: string, callback: 'oauth-callback' | 'oauth-token'): Promise<OAuthReturn | null> {
  if (Platform.OS !== 'web') {
    const result = await openAuthSessionAsync(authUrl, Linking.createURL(callback));
    return result.type === 'success' ? parseOAuthReturn(result.url) : null;
  }
  if (desktopShell()) {
    // The shell sends every new window to the system browser, and the relay's `comical://` bounce
    // comes back through `deliverOAuthReturn`.
    void Linking.openURL(authUrl);
    return awaitOAuthReturn();
  }
  return captureOAuthReturnWeb(authUrl);
}

/**
 * An implicit-grant `oauth-pin` (`response_type=token`, no `exchange`) is captured automatically —
 * no copy-paste. The provider redirects the token to our relay page, which returns it to the app; a
 * `code`-exchange field or a non-implicit `authUrl` still falls back to open-and-paste.
 */
function isImplicitCapture(descriptor: Extract<SettingDescriptor, { type: 'oauth-pin' }>): boolean {
  if (descriptor.exchange) return false;
  return /[?&]response_type=token(?:&|$)/.test(descriptor.authUrl);
}

/** Append a query param to an authorize URL. */
function withParam(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

/** Browser-tab capture: open the authorize URL as a popup and wait for the relay page to
 *  `postMessage` the provider's answer back. `null` if the user closes the popup first. */
function captureOAuthReturnWeb(authUrl: string): Promise<OAuthReturn | null> {
  return new Promise((resolve) => {
    const popup = window.open(authUrl, 'comical-oauth', 'width=520,height=680');
    if (!popup) {
      resolve({ error: 'Sign-in popup was blocked — allow popups for this site and try again.' });
      return;
    }
    let settled = false;
    const finish = (r: OAuthReturn | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(poll);
      resolve(r);
    };
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const onMessage = (e: MessageEvent) => {
      const data = e.data as Record<string, unknown> | null;
      if (!data || data.source !== 'comical-oauth') return;
      finish({ code: str(data.code), state: str(data.state), token: str(data.access_token), error: str(data.error) });
    };
    window.addEventListener('message', onMessage);
    const poll = setInterval(() => {
      if (popup.closed) finish(null);
    }, 700);
  });
}
