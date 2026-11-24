import { ModalBottomSheet, RNHostView, type ModalBottomSheetRef } from '@expo/ui/jetpack-compose';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { MaterialHost } from '@/components/material-host';
import type { MaterialOverlaySheetProps } from '@/components/overlay/material-overlay-sheet';
import { NativeSheetBody } from '@/components/overlay/overlay';
import { useWindowSize } from '@/hooks/use-window-size';

export const MATERIAL_SHEETS = true;

// Material's drag handle: 4dp, with 22dp above and below it.
const HANDLE = 48;

/**
 * An overlay item as Material's modal bottom sheet, on Android: Compose draws the sheet, its
 * handle, its scrim and the swipe and back that take it away, and the item's own React Native
 * content is hosted inside. The sheet is a window of its own, so the content gets a gesture root
 * there, and the host in the page is a point that draws nothing.
 */
export function MaterialOverlaySheet({ id, onClosed, register, children }: MaterialOverlaySheetProps) {
  const { width } = useWindowSize();
  const sheet = useRef<ModalBottomSheetRef>(null);
  const closed = useRef(false);
  useEffect(() => {
    const close = () => {
      if (closed.current) return;
      closed.current = true;
      onClosed();
    };
    register(id, () => {
      const hiding = sheet.current?.hide();
      if (hiding) void hiding.then(close, close);
      else close();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once: the stack's closer for this id
  }, []);
  return (
    <MaterialHost style={styles.host} pointerEvents="none">
      <ModalBottomSheet ref={sheet} skipPartiallyExpanded onDismissRequest={onClosed}>
        <RNHostView matchContents>
          <View style={{ width }}>
            <GestureHandlerRootView>
              <NativeSheetBody top={0} above={HANDLE}>
                {children}
              </NativeSheetBody>
            </GestureHandlerRootView>
          </View>
        </RNHostView>
      </ModalBottomSheet>
    </MaterialHost>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 1,
    height: 1,
  },
});
