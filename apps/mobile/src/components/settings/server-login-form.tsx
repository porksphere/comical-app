import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { OverlayHeading, useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { loginToServer, type ServerSession } from '@/data/server-session';
import { useTheme } from '@/hooks/use-theme';

/**
 * The shared sign-in overlay form: username + password (and, when the caller doesn't already know the
 * server, its URL) → `POST /login`. On success it hands the caller the new `ServerSession` so the
 * screen can wire its own side effects (clear the query cache, refresh sync). Modeled on
 * `RemoteServerForm` in `settings-general.tsx`.
 *
 * - The **General** screen passes a fixed `url` (the current remote server) → only two fields.
 * - The **Sync** screen omits `url` (embedded mode has no browse server set) → a URL field is shown.
 */
export function ServerLoginForm({ url, onSignedIn }: { url?: string; onSignedIn: (session: ServerSession) => void }) {
  const theme = useTheme();
  const { closeTop } = useOverlay();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const urlRef = useRef<TextInput>(null);
  const userRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);

  const fixedUrl = url !== undefined;
  const [serverUrl, setServerUrl] = useState(url ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = (fixedUrl || serverUrl.trim().length > 0) && username.trim().length > 0 && password.length > 0;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    const result = await loginToServer(fixedUrl ? (url as string) : serverUrl, username.trim(), password);
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.session);
      closeTop();
    } else {
      setError(result.error);
    }
  };

  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  return (
    <View style={styles.body}>
      <OverlayHeading>Sign in</OverlayHeading>
      <ThemedText type="small" themeColor="textSecondary">
        {fixedUrl
          ? `Sign in to ${url} with an account created on the server.`
          : 'Sign in to your Comical server with an account created on it.'}
      </ThemedText>

      {!fixedUrl && (
        <TextInput
          ref={urlRef}
          value={serverUrl}
          onChangeText={setServerUrl}
          onFocus={() => keyboardAvoiding.onFocus(urlRef.current)}
          onBlur={keyboardAvoiding.onBlur}
          placeholder="http://192.168.1.10:3100"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="next"
          onSubmitEditing={() => userRef.current?.focus()}
          style={inputStyle}
        />
      )}
      <TextInput
        ref={userRef}
        value={username}
        onChangeText={setUsername}
        onFocus={() => keyboardAvoiding.onFocus(userRef.current)}
        onBlur={keyboardAvoiding.onBlur}
        placeholder="Username"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        onSubmitEditing={() => passRef.current?.focus()}
        style={inputStyle}
      />
      <TextInput
        ref={passRef}
        value={password}
        onChangeText={setPassword}
        onFocus={() => keyboardAvoiding.onFocus(passRef.current)}
        onBlur={keyboardAvoiding.onBlur}
        placeholder="Password"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        returnKeyType="go"
        onSubmitEditing={submit}
        style={inputStyle}
      />

      {error && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      )}

      <View style={styles.actions}>
        <Pressable onPress={closeTop} style={styles.btn}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={submit} disabled={!canSubmit || busy} style={styles.btn}>
          {busy ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <ThemedText type="smallBold" style={{ color: canSubmit ? theme.accent : theme.textSecondary }}>
              Sign in
            </ThemedText>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
    marginTop: Spacing.one,
  },
  btn: {
    paddingVertical: Spacing.two,
  },
});
