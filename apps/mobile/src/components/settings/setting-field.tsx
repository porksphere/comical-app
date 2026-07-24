import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { openAuthSessionAsync, openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ChevronRightIcon, MinusIcon, PlusIcon } from '@/components/icons/ui-icons';
import { MeasuredHeader, OptionList, OverlayHeading, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { SettingsSelectRow, SettingsTextRow, SettingsToggleRow, type SettingsOption } from '@/components/settings/settings-fields';
import { settingsRowFrame, SettingsRow } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { completeOAuthCallback, getApiBase, type SettingDescriptor, type SettingValue } from '@/data/api';
import { embeddedOAuthCallbackUrl, isEmbeddedRuntimeAvailable, useEmbeddedEnabled } from '@/data/embedded';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight, hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

type FieldProps<D extends SettingDescriptor> = {
  descriptor: D;
  value: SettingValue | undefined;
  /** True when a `secret`/oauth field already has a stored value server-side (the server never
   *  sends the value itself, just this flag) — drives the oauth rows' Connected/Not-connected state. */
  secretSet?: boolean;
  /** The tracker this descriptor belongs to — only set from `tracker-settings.tsx`. Required to
   *  start an `oauth-callback` round trip (`POST /trackers/:id/oauth-start`); bridges never
   *  declare oauth fields, so `bridge-settings.tsx` omits it. */
  trackerId?: string;
  onChange: (v: SettingValue) => void;
};

/** Label with a trailing `*` for a required field. */
const fieldLabel = (d: SettingDescriptor): string => `${d.label}${'required' in d && d.required ? ' *' : ''}`;

/**
 * Dispatches to the right control for a `SettingDescriptor`, one per descriptor inside a
 * `SettingsSection` (`bridge-settings.tsx` / `tracker-settings.tsx`). Every type renders as a standard
 * settings row — string/number via `SettingsTextRow`, boolean via `SettingsToggleRow`, a single enum
 * via `SettingsSelectRow` — so a bridge's config reads like the rest of Settings. Multi-select enums
 * and bounded numbers keep their own controls (a multi picker, a ± stepper), framed as rows.
 */
export function SettingFieldEditor({ descriptor, value, secretSet, trackerId, onChange }: FieldProps<SettingDescriptor>) {
  switch (descriptor.type) {
    case 'string':
      return (
        <SettingsTextRow
          label={fieldLabel(descriptor)}
          description={descriptor.description}
          value={(value as string | undefined) ?? ''}
          onChange={onChange}
          // A secret reads as a password field: a masked dots placeholder (whether or not one is
          // already stored — leaving it blank keeps the existing value), revealed with the eye button.
          placeholder={descriptor.secret ? '••••••••' : (descriptor.placeholder ?? 'Type…')}
          secureTextEntry={!!descriptor.secret}
          autoCapitalize="none"
          autoCorrect={false}
        />
      );
    case 'number':
      if (descriptor.min !== undefined && descriptor.max !== undefined) {
        return <StepperRow descriptor={descriptor} value={value as number | undefined} onChange={onChange} />;
      }
      return (
        <SettingsTextRow
          label={fieldLabel(descriptor)}
          description={descriptor.description}
          // Sent as a raw string on save — the server's settings validator coerces a numeric string.
          value={value === undefined ? '' : String(value)}
          onChange={onChange}
          keyboardType="numeric"
          placeholder={descriptor.default !== undefined ? String(descriptor.default) : undefined}
        />
      );
    case 'boolean':
      return (
        <SettingsToggleRow
          label={fieldLabel(descriptor)}
          description={descriptor.description}
          value={(value as boolean | undefined) ?? descriptor.default ?? false}
          onChange={onChange}
        />
      );
    case 'enum':
      if (descriptor.multiple) {
        return <MultiEnumRow descriptor={descriptor} value={value} onChange={onChange} />;
      }
      return (
        <SettingsSelectRow
          label={fieldLabel(descriptor)}
          description={descriptor.description}
          value={typeof value === 'string' ? value : ''}
          options={descriptor.options.map((o): SettingsOption<string> => ({ value: o.value, label: o.label }))}
          onChange={onChange}
          heading={descriptor.label}
          placeholder="Select…"
        />
      );
    case 'oauth-pin':
      return <OAuthPinRow descriptor={descriptor} value={value} secretSet={secretSet} onChange={onChange} />;
    case 'oauth-callback':
      return <OAuthCallbackRow descriptor={descriptor} secretSet={secretSet} trackerId={trackerId} />;
  }
}

/** An `oauth-callback` field: no value is ever typed in — the whole exchange happens through a
 *  browser round trip. Requires `trackerId` (only `tracker-settings.tsx` passes one; bridges
 *  never declare this field type).
 *
 *  Remote mode redirects to the server's own `/oauth/callback`, which does the whole exchange
 *  itself. On-device there's no server to redirect to, so the auth URL is built (server-side, at
 *  `oauth-start` time) around this app's own custom-scheme deep link instead
 *  (`embeddedOAuthCallbackUrl`) — `openAuthSessionAsync` intercepts that redirect itself, and the
 *  app finishes the exchange by hitting the *same* `/oauth/callback` route through the in-process
 *  embedded router (`completeOAuthCallback`). Either way the round trip completes without this
 *  component ever handling a token. */
function OAuthCallbackRow({
  descriptor,
  secretSet,
  trackerId,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'oauth-callback' }>;
  secretSet?: boolean;
  trackerId?: string;
}) {
  const theme = useTheme();
  const ds = useDataSource();
  const queryClient = useQueryClient();
  const [onDevice] = useEmbeddedEnabled();
  const embeddedActive = onDevice && isEmbeddedRuntimeAvailable();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (!trackerId || connecting) return;
    setError(null);
    setConnecting(true);
    try {
      const { authUrl } = await ds.startTrackerOAuth(trackerId, descriptor.key);
      if (embeddedActive) {
        const result = await openAuthSessionAsync(authUrl, embeddedOAuthCallbackUrl);
        if (result.type !== 'success') return;
        const { queryParams } = Linking.parse(result.url);
        const code = typeof queryParams?.code === 'string' ? queryParams.code : undefined;
        const state = typeof queryParams?.state === 'string' ? queryParams.state : undefined;
        if (!code || !state) throw new Error('Sign-in did not return an authorization code.');
        await completeOAuthCallback(code, state);
      } else {
        // Don't trust the resolved session type — on web this just resolves when the popup closes
        // (which the server's callback page does via `window.close()` once it's done), and on
        // native it resolves on redirect. Either way the server already did the real work; just
        // refetch and let "Connected" reflect whatever actually landed.
        await openAuthSessionAsync(authUrl, `${getApiBase()}/oauth/callback`);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.trackerSettings(trackerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.trackers() }),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start sign-in');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <SettingsRow
      label={descriptor.label}
      description={error ?? (secretSet ? 'Connected' : (descriptor.description ?? 'Not connected'))}
      descriptionColor={error ? theme.danger : secretSet ? undefined : theme.badgeWarn}
      right={
        connecting ? (
          <ActivityIndicator />
        ) : (
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {secretSet ? 'Reconnect' : 'Connect'}
          </ThemedText>
        )
      }
      onPress={connecting || !trackerId ? undefined : connect}
      testID={testId('settings.oauth', descriptor.label)}
    />
  );
}

/**
 * The app's own URL scheme (`comical` on a native build, `http(s)` on web), e.g. from
 * `Linking.createURL('') === 'comical://'`. Used to recognise an implicit-grant redirect that lands
 * back in this app so we can intercept it via an in-app auth session instead of copy-paste.
 */
const appScheme = Linking.createURL('').match(/^([a-z0-9.+-]+):/i)?.[1] ?? '';

/**
 * When a descriptor is an implicit-grant `oauth-pin` (no `exchange`) whose `authUrl` redirects back
 * into *this app's own scheme*, we can capture the token automatically: an in-app auth session
 * intercepts the redirect and hands us the URL with the token in its fragment. Returns that
 * redirect URI (to hand to `openAuthSessionAsync`), or `null` when the field is a plain
 * open-and-paste flow (a code-exchange field, or an implicit token shown on a provider web page).
 */
function autoCaptureRedirect(descriptor: Extract<SettingDescriptor, { type: 'oauth-pin' }>): string | null {
  if (descriptor.exchange || !appScheme) return null;
  const m = descriptor.authUrl.match(/[?&]redirect_uri=([^&]+)/);
  if (!m) return null;
  const redirect = decodeURIComponent(m[1]);
  return redirect.toLowerCase().startsWith(`${appScheme.toLowerCase()}:`) ? redirect : null;
}

/** Pull an implicit-grant token out of an intercepted redirect URL's fragment
 *  (`comical://…#access_token=…&token_type=Bearer`). Parsed by hand — no `URL`/`URLSearchParams`
 *  reliance, which is spotty across JS engines (Hermes/JSC). */
function tokenFromRedirect(url: string): string | undefined {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  for (const pair of hash.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq) === 'access_token') return decodeURIComponent(pair.slice(eq + 1));
  }
  return undefined;
}

/** An `oauth-pin` field. Two shapes:
 *  - **Auto-capture** (`autoCaptureRedirect` matches): a single "Connect" row that opens an in-app
 *    auth session and pulls the implicit-grant token straight out of the redirect fragment — no
 *    copy-paste. Used by trackers (e.g. AniList) that redirect back into the app's own scheme.
 *  - **Open-and-paste** (otherwise): the user opens the auth URL, then pastes back an authorization
 *    code (`exchange` set — server exchanges it) or the raw token (implicit, shown on a provider page).
 *  Either way the token/code flows through the caller's existing `onChange`/save flow — no new
 *  mutation, same as any other secret string field (the user still taps the screen's Save button). */
function OAuthPinRow({
  descriptor,
  value,
  secretSet,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'oauth-pin' }>;
  value: SettingValue | undefined;
  secretSet?: boolean;
  onChange: (v: SettingValue) => void;
}) {
  const theme = useTheme();
  const captureRedirect = autoCaptureRedirect(descriptor);
  const [connecting, setConnecting] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (captureRedirect) {
    const connect = async () => {
      if (connecting) return;
      setError(null);
      setConnecting(true);
      try {
        const result = await openAuthSessionAsync(descriptor.authUrl, captureRedirect);
        if (result.type !== 'success') return; // user dismissed — leave state as-is
        const token = tokenFromRedirect(result.url);
        if (!token) throw new Error('Sign-in did not return an access token.');
        onChange(token); // staged like a paste; the screen's Save button persists it
        setCaptured(true);
      } catch (e) {
        setCaptured(false);
        setError(e instanceof Error ? e.message : 'Sign-in failed');
      } finally {
        setConnecting(false);
      }
    };
    const description = error
      ? error
      : captured
        ? 'Signed in — tap Save to finish'
        : secretSet
          ? 'Connected'
          : (descriptor.description ?? 'Not connected');
    return (
      <SettingsRow
        label={descriptor.label}
        description={description}
        descriptionColor={error ? theme.danger : captured ? theme.accent : secretSet ? undefined : theme.badgeWarn}
        right={
          connecting ? (
            <ActivityIndicator />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {secretSet || captured ? 'Reconnect' : 'Connect'}
            </ThemedText>
          )
        }
        onPress={connecting ? undefined : connect}
        testID={testId('settings.oauth', descriptor.label)}
      />
    );
  }

  return (
    <>
      <SettingsRow
        label={descriptor.label}
        description={secretSet ? 'Connected' : (descriptor.description ?? 'Not connected')}
        descriptionColor={secretSet ? undefined : theme.badgeWarn}
        right={
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Open
          </ThemedText>
        }
        onPress={() => {
          void openBrowserAsync(descriptor.authUrl);
        }}
        testID={testId('settings.oauth', descriptor.label)}
      />
      <SettingsTextRow
        label={descriptor.exchange ? 'Authorization code' : 'Access token'}
        value={(value as string | undefined) ?? ''}
        onChange={onChange}
        placeholder={secretSet ? '••••••••' : 'Paste here…'}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
    </>
  );
}

/** A bounded number as a settings row: label on the left, a −/+ stepper on the right. */
function StepperRow({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'number' }>;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const min = descriptor.min!;
  const max = descriptor.max!;
  const n = value ?? descriptor.default ?? min;
  const base = testId('settings.stepper', fieldLabel(descriptor));
  return (
    <View style={[settingsRowFrame.row, settingsRowFrame.escape]}>
      <View style={settingsRowFrame.text}>
        <ThemedText type="small" numberOfLines={1}>
          {fieldLabel(descriptor)}
        </ThemedText>
        {descriptor.description && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {descriptor.description}
          </ThemedText>
        )}
      </View>
      <View style={styles.stepper}>
        <StepperButton icon="minus" testID={testId(base, 'decrement')} disabled={n <= min} onPress={() => onChange(Math.max(min, n - 1))} />
        <ThemedText type="smallBold" style={styles.stepperValue}>
          {n}
        </ThemedText>
        <StepperButton icon="plus" testID={testId(base, 'increment')} disabled={n >= max} onPress={() => onChange(Math.min(max, n + 1))} />
      </View>
    </View>
  );
}

function StepperButton({ icon, onPress, disabled, testID }: { icon: 'minus' | 'plus'; onPress: () => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      disabled={disabled}
      android_ripple={{ color: theme.backgroundElement, borderless: true }}
      style={[styles.pressableCursor, disabled && styles.stepBtnDisabled]}>
      <ThemedView type="backgroundSelected" style={styles.stepBtn}>
        {icon === 'minus' ? <MinusIcon color={theme.text} size={18} /> : <PlusIcon color={theme.text} size={18} />}
      </ThemedView>
    </Pressable>
  );
}

/** A multi-select enum as a settings row: label on the left, a comma-joined summary + chevron on the
 *  right, tapping opens the multi-select picker (which stays open as you toggle options). */
function MultiEnumRow({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'enum' }>;
  value: SettingValue | undefined;
  onChange: (v: SettingValue) => void;
}) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const selected = Array.isArray(value) ? value : [];
  const base = testId('settings.multi', fieldLabel(descriptor));
  const summary =
    selected.length === 0
      ? 'None selected'
      : descriptor.options
          .filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(', ');
  return (
    <Pressable
      testID={base}
      ref={ref}
      onPress={() => {
        hapticImpactLight();
        openAt(() => <EnumPicker descriptor={descriptor} value={value} onChange={onChange} testID={base} />);
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <View style={[settingsRowFrame.row, settingsRowFrame.escape, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <View style={settingsRowFrame.text}>
          <ThemedText type="small" numberOfLines={1}>
            {fieldLabel(descriptor)}
          </ThemedText>
          {descriptor.description && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {descriptor.description}
            </ThemedText>
          )}
        </View>
        <View style={styles.rowValue}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.summary}>
            {summary}
          </ThemedText>
          <ChevronRightIcon color={theme.textSecondary} size={18} />
        </View>
      </View>
    </Pressable>
  );
}

function EnumPicker({
  descriptor,
  value,
  onChange,
  testID,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'enum' }>;
  value: SettingValue | undefined;
  onChange: (v: SettingValue) => void;
  testID: string;
}) {
  const { closeTop } = useOverlay();
  const selected = Array.isArray(value) ? value : [];
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  return (
    <View style={styles.body}>
      <MeasuredHeader>
        <OverlayHeading>{descriptor.label}</OverlayHeading>
      </MeasuredHeader>
      <OptionList>
        {descriptor.options.map((opt) => (
          <EnumOption
            key={opt.value}
            testID={testId(testID, 'option', opt.value)}
            label={opt.label}
            on={selected.includes(opt.value)}
            onPress={() => toggle(opt.value)}
          />
        ))}
        {/* A "Done" affordance isn't needed — dismissing the sheet commits; the toggles are live. */}
        {selected.length > 0 && (
          <Pressable testID={testId(testID, 'done')} onPress={closeTop} style={styles.pressableCursor}>
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold" style={{ color: '#3478F6' }}>
                Done
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}
      </OptionList>
    </View>
  );
}

function EnumOption({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <ThemedView type={hovered ? 'backgroundSelected' : 'backgroundElement'} style={styles.row}>
        <ThemedText>{label}</ThemedText>
        <View style={[styles.check, on && { borderColor: theme.accent, backgroundColor: theme.accent }]} />
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepperValue: {
    minWidth: 28,
    textAlign: 'center',
  },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
    minWidth: 0,
  },
  summary: {
    flexShrink: 1,
    minWidth: 0,
  },
  // No `flex: 1` (see `sheetBody` in overlay.tsx) — hugs its MeasuredHeader/OptionList content.
  body: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  pressableCursor: {
    cursor: 'pointer',
  },
});
