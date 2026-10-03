/**
 * The phone's half of pairing: point the camera at the code the desktop shows (Settings → Sync →
 * Sync server for your phone) and the address in it becomes this app's server. Native only — a
 * desktop is the end that shows the code, and the web build has no camera to speak of.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { switchServer } from '@/data/switch-server';
import { parseSyncAddress } from '@/data/sync-address';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

export default function ScanSyncServerScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [paired, setPaired] = useState(false);
  // The camera reports the same code many times a second; one refusal per code is enough.
  const refused = useRef<string | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const onScanned = ({ data }: { data: string }) => {
    if (paired) return;
    const address = parseSyncAddress(data);
    if (!address) {
      if (refused.current !== data) showToast("That isn't a Comical pairing code.");
      refused.current = data;
      return;
    }
    setPaired(true);
    switchServer(address.url, address.secret);
    showToast('Paired. Syncing with your computer.');
    router.back();
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
            onBarcodeScanned={paired ? undefined : onScanned}
          />
          <View style={styles.hint}>
            <ThemedText type="small" style={styles.hintText}>
              On your computer: Settings → Sync → Sync server for your phone.
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
