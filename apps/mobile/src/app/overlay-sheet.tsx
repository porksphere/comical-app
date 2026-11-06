import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

import { NativeSheetBody } from '@/components/overlay/overlay';
import { attachNativeSheet, nativeSheetContent } from '@/lib/native-overlay-sheets';
import { router, useLocalSearchParams } from '@/lib/nav';

/**
 * One item of the overlay stack, presented as a system form sheet (iOS; see
 * lib/native-overlay-sheets). The route holds nothing of its own: `id` names the item and the store
 * holds its content. Reached any other way — a stale URL on web — it finds no item and leaves.
 */
export default function OverlaySheetRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const sheet = Number(id);
  useEffect(
    () =>
      attachNativeSheet(sheet, () => {
        if (navigation.canGoBack()) navigation.goBack();
        else router.replace('/');
      }),
    [navigation, sheet],
  );
  const content = nativeSheetContent(sheet);
  return content === undefined ? null : <NativeSheetBody>{content}</NativeSheetBody>;
}
