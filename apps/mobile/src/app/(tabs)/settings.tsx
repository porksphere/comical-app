import { StyleSheet, Switch, View } from 'react-native';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { API_BASE } from '@/data/api';
import { useHideNsfw, useMockDataToggle } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  return (
    <PlaceholderScreen title="Settings">
      <GeneralSection />
      {__DEV__ && <DeveloperSection />}
    </PlaceholderScreen>
  );
}

/** Formalized into `SettingsSection`/`SettingsRow` once the full screen shell lands. */
function GeneralSection() {
  const theme = useTheme();
  const [hideNsfw, setHideNsfw] = useHideNsfw();
  return (
    <ThemedView type="backgroundElement" style={[styles.section, { borderColor: theme.hairline }]}>
      <ThemedText type="smallBold">General</ThemedText>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <ThemedText type="small">Hide NSFW content</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Hides NSFW-flagged bridges from the Browse tab.
          </ThemedText>
        </View>
        <Switch value={hideNsfw} onValueChange={setHideNsfw} />
      </View>
    </ThemedView>
  );
}

/** Dev-build-only: lets local development iterate against mock data without a
 *  running backend, and shows which server real requests target. Stripped from
 *  real production builds by the `__DEV__` check above (see `data/source.ts`). */
function DeveloperSection() {
  const theme = useTheme();
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  return (
    <ThemedView type="backgroundElement" style={[styles.section, { borderColor: theme.hairline }]}>
      <ThemedText type="smallBold">Developer</ThemedText>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <ThemedText type="small">Use mock data</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Browse/Series/Reader render generated sample content instead of calling the API.
          </ThemedText>
        </View>
        <Switch value={mockEnabled} onValueChange={setMockEnabled} />
      </View>

      <View style={styles.rowText}>
        <ThemedText type="small">Server</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" selectable>
          {API_BASE}
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.five,
    padding: Spacing.four,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
