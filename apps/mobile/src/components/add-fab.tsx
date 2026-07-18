/**
 * A floating circular "add" button (FAB) pinned to a screen's bottom-right corner. Solid accent
 * circle, deliberately the SAME size and slot as the select-mode Delete pill (`SelectPillBar`'s
 * lone-verb circle) so the add affordance and the bulk-action affordance swap cleanly in the same
 * corner: the FAB shows in normal mode, the caller hides it and shows the pill bar in select mode.
 *
 * The caller positions it (`right`/`bottom`, matching the pill bar's own insets) and owns when it's
 * shown. Purely presentational — it just calls `onPress`.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { PlusIcon } from '@/components/icons/ui-icons';
import { PILL_HEIGHT } from '@/components/multi-select/select-mode';
import { useTheme } from '@/hooks/use-theme';

export function AddFab({
  onPress,
  testID,
  label = 'Add',
  right,
  bottom,
}: {
  onPress: () => void;
  testID: string;
  /** Accessible label, e.g. "Add page". */
  label?: string;
  right: number;
  bottom: number;
}) {
  const theme = useTheme();
  return (
    // box-none so taps between the FAB and the rest of the screen pass through to the list.
    <View pointerEvents="box-none" style={[styles.host, { right, bottom }]}>
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.fab, { backgroundColor: theme.accent }]}>
        <PlusIcon color={theme.accentOn} size={26} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
  },
  // Matches SelectPillBar's lone-verb circle: PILL_HEIGHT square, fully rounded, same shadow — so the
  // add FAB and the bulk-delete pill read as the same object swapping colour/role in one corner.
  fab: {
    width: PILL_HEIGHT,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
