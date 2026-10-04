/**
 * The phone's half of pairing: point the camera at the code the desktop shows (Settings → Sync →
 * Pair a phone) and this phone pairs with the computer at the address in it. Native only — a
 * desktop is the end that shows the code, and the web build has no camera to speak of.
 */
import { SyncPairingError } from '@comical/sync';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { connectServer, pairingFailureMessage } from '@/data/switch-server';
import { parseSyncAddress } from '@/data/sync-address';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

/** How long a code that couldn't reach its computer is left alone before the camera's next sighting tries it again. */
const RETRY_AFTER_MS = 4000;

export default function ScanSyncServerScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [pairing, setPairing] = useState(false);
  // The camera reports the same code many times a second; one refusal per code is enough, for good
  // when the code itself is the problem.
  const refused = useRef<{ data: string; until: number } | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const onScanned = ({ data }: { data: string }) => {
    if (pairing) return;
    if (refused.current?.data === data && Date.now() < refused.current.until) return;
    const address = parseSyncAddress(data);
    if (!address) {
      refused.current = { data, until: Infinity };
      showToast("That isn't a Comical pairing code.");
      return;
    }
    setPairing(true);
    connectServer(address).then(
      () => {
        showToast('Paired. Syncing with your computer.');
        router.back();
      },
      (e: unknown) => {
        refused.current = { data, until: e instanceof SyncPairingError ? Infinity : Date.now() + RETRY_AFTER_MS };
        showToast(pairingFailureMessage(e));
        setPairing(false);
      },
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Scan a code" />
      {permission?.granted ? (
        <View style={styles.camera} testID="scanSyncServer.camera">
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={pairing ? undefined : onScanned}
          />
          <View style={styles.hint}>
            <ThemedText type="small" style={styles.hintText}>
              {pairing ? 'Pairing…' : 'On your computer: Settings → Sync → Pair a phone.'}
            </ThemedText>
          </View>
        </View>
      ) : (
        <View style={styles.denied}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.deniedText}>
            {permission === null || permission.canAskAgain
              ? 'Comical needs the camera to read the code on your computer.'
              : 'Camera access is off for Comical. Turn it on in your phone’s settings to scan the code.'}
          </ThemedText>
          {permission && !permission.canAskAgain && (
            <Pressable testID="scanSyncServer.open-settings" onPress={() => void Linking.openSettings()} style={styles.button}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Open settings
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  hint: {
    margin: Spacing.four,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  hintText: {
    color: '#fff',
    textAlign: 'center',
  },
  denied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.three,
  },
  deniedText: {
    textAlign: 'center',
  },
  button: {
    paddingVertical: Spacing.two,
  },
});
