import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ReaderSettingsBody } from '@/components/reader/settings-panel';
import { useLocalSearchParams, useRouter } from '@/lib/nav';

/**
 * The reader's settings as a system form sheet (iOS; see the root layout for its presentation and
 * `settings-panel.ios` for the form). Edits apply as they are made; Done only closes the sheet.
 * `seriesKey` is the series the spread shift is stored against — the one thing the reader has that
 * the settings store doesn't.
 */
export default function ReaderSettingsSheet() {
  const { seriesKey } = useLocalSearchParams<{ seriesKey?: string }>();
  const router = useRouter();
  return (
    <View style={styles.fill}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" accessibilityLabel="Done" onPress={() => router.back()}>
          Done
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ReaderSettingsBody seriesKey={seriesKey ?? null} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
