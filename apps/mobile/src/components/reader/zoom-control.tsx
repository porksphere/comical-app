import { Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  formatZoom,
  isDesktopPointer,
  resetZoom,
  stepZoom,
  useZoomAvailable,
  useZoomLevel,
} from '@/components/reader/desktop-zoom';
import { MinusIcon, PlusIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const BUTTON_W = 28;
const LABEL_W = 44;
/** What the stepper adds to the toolbar's trailing slot (see ReaderToolbar's `trailingWidth`). */
export const ZOOM_CONTROL_W = BUTTON_W * 2 + LABEL_W + Spacing.two;

/** Shown on a mouse-and-keyboard web session while a reader can zoom — touch has its pinch. */
export function useZoomControlShown(): boolean {
  const available = useZoomAvailable();
  return Platform.OS === 'web' && available && isDesktopPointer();
}

/** The toolbar's `[−] 125% [+]`: steps the page zoom, and the level itself resets it. No toast —
 *  the level is right there. */
export function ZoomControl({ onPress }: { onPress?: () => void }) {
  const level = useZoomLevel();
  const press = (act: () => void) => () => {
    act();
    onPress?.();
  };
  return (
    <View style={styles.row}>
      <Pressable
        testID="reader.zoom.out"
        onPress={press(() => stepZoom(-1, { toast: false }))}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Zoom out">
        <MinusIcon color="#fff" size={18} />
      </Pressable>
      <Pressable
        testID="reader.zoom.level"
        onPress={press(() => resetZoom({ toast: false }))}
        style={styles.label}
        accessibilityRole="button"
        accessibilityLabel={`Page zoom ${formatZoom(level)}, reset`}>
        <ThemedText type="small" style={styles.labelText}>
          {formatZoom(level)}
        </ThemedText>
      </Pressable>
      <Pressable
        testID="reader.zoom.in"
        onPress={press(() => stepZoom(1, { toast: false }))}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Zoom in">
        <PlusIcon color="#fff" size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  button: {
    width: BUTTON_W,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    width: LABEL_W,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
});
