import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type CollectPageProps, MENU_GAP, useCollectPage } from '@/components/reader/collect-page-control';
import { useReaderSettingsOverlay } from '@/components/reader/settings-panel';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTopBarHeight } from '@/hooks/use-responsive';

/**
 * The reader's controls in the iOS navigation bar — the SAME bar the details just had, so the
 * back button stays where it was and only the bar's face changes: the save-this-page bookmark and
 * the settings gear as two glass bar buttons where the custom toolbar's trailing slot put them
 * (`ReaderToolbar`, which Android and web keep). The bar itself follows the chrome's auto-hide
 * through the route's `headerShown`, so it slides away and back the way UIKit's does.
 *
 * A bar button has a press and nothing else, so the custom button's long-press (the collections
 * picker outright) is not here: a saved page's tap opens the picker, as it does there, and an
 * unsaved page's tap saves it first. A spread asks which page the way the custom button does,
 * from a menu hung under the bar's trailing edge — the button is UIKit's and cannot be measured.
 *
 * Rendered by the series page only while the reader is up and this is the top layer: the bar
 * reads the element tree, so these must be direct children of `Stack.Toolbar`, and the component
 * boundary is this one's — not one per button.
 */
export function ReaderNativeToolbar({
  seriesKey,
  onHoldChrome,
  onPress,
  ...page
}: CollectPageProps & {
  /** `bridgeId:seriesId` — what the settings sheet stores the per-series spread shift against. */
  seriesKey: string | null;
  /** Keeps the chrome up while the settings sheet is open. */
  onHoldChrome: (hold: boolean) => void;
  /** Called on either press so the chrome's auto-hide countdown restarts. */
  onPress: () => void;
}) {
  const { collected, save, spread, spreadMenu } = useCollectPage(page);
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  const { open: openSettings } = useReaderSettingsOverlay(seriesKey, onHoldChrome);
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon={collected ? 'bookmark.fill' : 'bookmark'}
        selected={!!collected}
        disabled={collected === null}
        accessibilityLabel={collected ? 'Saved page — choose collections' : 'Save page'}
        onPress={() => {
          onPress();
          const shown = spread();
          if (shown) {
            spreadMenu(shown, 'save', {
              under: { right: Spacing.three, top: insets.top + barHeight + MENU_GAP },
              keyboard: false,
            });
          } else {
            save(page.pageIndex, false);
          }
        }}
      />
      <Stack.Toolbar.Button
        icon="gearshape"
        accessibilityLabel="Reader settings"
        onPress={() => {
          onPress();
          openSettings();
        }}
      />
    </Stack.Toolbar>
  );
}

/**
 * The reader's title in the bar: the series over its chapter, as the custom toolbar stacks them.
 * White, never the theme's: the reader stays dark whatever the app theme is, and the bar is
 * transparent over the page. Handed to the route as its `headerTitle` — a title view, which the
 * bar carries the way it carries any title.
 */
export function ReaderBarTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.titles}>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      {!!subtitle && (
        <ThemedText type="small" numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titles: {
    alignItems: 'center',
  },
  title: {
    color: '#fff',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
});
