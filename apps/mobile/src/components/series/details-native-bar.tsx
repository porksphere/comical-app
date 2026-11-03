import { Stack } from 'expo-router';
import { useState } from 'react';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';

import { BarContentGap } from '@/constants/theme';
import { useNativeHeaderHeight } from '@/hooks/use-native-header';
import { SLIDE_AWAY_BAR, useBarMaterial } from '@/lib/native-bar';

/**
 * The series details' system bar on iOS, through the route's options. The content scrolls under it,
 * and it slides away while that happens, like every pushed page's (SLIDE_AWAY_BAR).
 *
 * Over the strip it is bare, with the page's own title below it. Once that title has gone under the
 * bar, the bar takes over: the series' title on the frosted material. The switch is an option change
 * like any other, so it is its own component and a crossing re-renders this much and no more. Those
 * options go through react-native-screens' whole header update, which also rebuilds the bar's items,
 * so the switch is not animated. A pushed card's back button is the system's and isn't one of them.
 *
 * With no title, the bar collapses where the back button has moved to the Duo's vertical bar. With
 * no material either, there is nothing left of it to see.
 *
 * Only the top instance mounts this (the options are the route's, shared by every layer), so a
 * layer that becomes top again re-applies them: Stack.Screen's effect runs on mount, and the toolbar
 * unregisters its item on unmount. Inside a tab the route is the tab stack's own pushed card
 * (useNativePush), whose back button is the system's, the one the tab's leading item morphs into. At
 * the root the route these options reach is the `index` of the nested stack (app/series/_layout),
 * never the contained transparent modal around it: react-native-screens remounts a modal's content
 * when its `headerShown` flips, as the search layer flips it; a nested root has no back of its own,
 * hence the toolbar chevron.
 */
export function SeriesDetailsNativeBar({
  title,
  nativePush,
  onClose,
  scrollOffset,
  contentTop,
  inlineTitleHeight,
}: {
  title: string;
  nativePush: boolean;
  onClose: () => void;
  scrollOffset: SharedValue<number>;
  /** Where the list's content starts, before its own gap: the height of the strip above it. */
  contentTop: number;
  inlineTitleHeight: SharedValue<number>;
}) {
  const material = useBarMaterial();
  const barBottom = useNativeHeaderHeight();
  const [pastTitle, setPastTitle] = useState(false);
  const titleTop = contentTop + BarContentGap - barBottom;
  useAnimatedReaction(
    () => scrollOffset.value > titleTop + inlineTitleHeight.value,
    (past, prev) => {
      if (past !== prev) runOnJS(setPastTitle)(past);
    },
    [titleTop],
  );
  const barTitle = pastTitle ? title : '';
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerBlurEffect: pastTitle ? material : 'none',
          headerBackVisible: nativePush,
          // Not a pushed card, nothing for UIKit to pop: the edge is the page's own back-swipe.
          gestureEnabled: nativePush,
          title: barTitle,
          headerTitle: barTitle,
          unstable_nativeProps: SLIDE_AWAY_BAR,
        }}
      />
      {!nativePush ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Go back" onPress={onClose} />
        </Stack.Toolbar>
      ) : null}
    </>
  );
}
