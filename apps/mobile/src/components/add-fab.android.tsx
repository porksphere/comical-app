import { FloatingActionButton, Icon } from '@expo/ui/jetpack-compose';
import { paddingAll, testID as testTag } from '@expo/ui/jetpack-compose/modifiers';
import { StyleSheet, View } from 'react-native';

import type { AddFabProps } from '@/components/add-fab';
import { materialSymbol } from '@/components/icons/material-symbols';
import { MaterialHost } from '@/components/material-host';

// Room round the button for its shadow, which the host's bounds would otherwise cut.
const SHADOW_ROOM = 8;

/** Android's add button: Material's floating action button, in the corner the caller names. */
export function AddFab({ onPress, testID, label = 'Add', right, bottom }: AddFabProps) {
  return (
    // box-none so taps between the button and the rest of the screen pass through to the list.
    <View pointerEvents="box-none" style={[styles.host, { right: right - SHADOW_ROOM, bottom: bottom - SHADOW_ROOM }]}>
      <MaterialHost matchContents>
        <FloatingActionButton onClick={onPress} modifiers={[paddingAll(SHADOW_ROOM), testTag(testID)]}>
          <FloatingActionButton.Icon>
            <Icon source={materialSymbol('plus')!} contentDescription={label} />
          </FloatingActionButton.Icon>
        </FloatingActionButton>
      </MaterialHost>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
  },
});
