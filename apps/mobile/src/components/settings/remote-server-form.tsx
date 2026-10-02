/**
 * The sheet that edits which server the app talks to. Two rows open it — General's "Remote server"
 * (the backend, while bridges run on a server) and Sync's "Sync server" (the hub, while they run on
 * the device) — and it is one form because they set one value: `switchServer`.
 *
 * Mirrors `AddRegistryForm`'s text-input-plus-save shape in `registries.tsx`.
 */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { OverlayHeading, useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { parseSyncAddress } from '@/data/sync-address';
import { useTheme } from '@/hooks/use-theme';

export function RemoteServerForm({
  title,
  description,
  currentUrl,
  onSave,
  onScan,
}: {
  title: string;
  description: string;
  currentUrl: string;
  onSave: (url: string | null, secret?: string) => void;
  /** Open the pairing-code scanner; absent where there is no camera. */
  onScan?: () => void;
}) {
  const theme = useTheme();
  const { closeTop } = useOverlay();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [url, setUrl] = useState(currentUrl);

  return (
    <View style={styles.body}>
      <OverlayHeading>{title}</OverlayHeading>
      <ThemedText type="small" themeColor="textSecondary">
        {description}
      </ThemedText>
      <TextInput
        ref={inputRef}
        testID="settings.general.remote-server.input"
        value={url}
        onChangeText={setUrl}
        onFocus={() => keyboardAvoiding.onFocus(inputRef.current)}
        onBlur={keyboardAvoiding.onBlur}
        placeholder="http://localhost:3100"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      <View style={styles.actions}>
        {onScan && (
          <Pressable
            testID="settings.general.remote-server.scan"
            onPress={() => {
              closeTop();
              onScan();
            }}
            style={[styles.btn, styles.lead]}>
            <ThemedText type="smallBold">Scan a code</ThemedText>
          </Pressable>
        )}
        <Pressable
          testID="settings.general.remote-server.reset"
          onPress={() => {
            onSave(null);
            closeTop();
          }}
          style={styles.btn}>
          <ThemedText type="smallBold">Reset to default</ThemedText>
        </Pressable>
        <Pressable
          testID="settings.general.remote-server.save"
          onPress={() => {
            // A pairing code typed from the desktop's sheet carries its key; anything else is
            // saved as typed, as a server that speaks in the clear.
            const address = parseSyncAddress(url);
            onSave(address?.url ?? url, address?.secret);
            closeTop();
          }}
          // Saving the server shown would re-save it without its key.
          disabled={!url.trim() || url.trim() === currentUrl}
          style={styles.btn}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Save
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
  },
  btn: {
    paddingVertical: Spacing.two,
  },
  lead: {
    marginRight: 'auto',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
