import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { useBarScrolled, useManagesBar } from '@/components/bar-scrolled';
import { barTitleStyle } from '@/components/native-tab-header';
import { ThemedText } from '@/components/themed-text';
import { logDiagnostic } from '@/lib/diagnostics';
import { HIDDEN_TOP_EDGE, SLIDE_AWAY_BAR, useBarMaterial } from '@/lib/native-bar';

import { NavBarFade } from '../../../modules/nav-bar-fade';

/**
 * The series details' system bar on iOS, through the route's options: every pushed page's, the
 * series' title in it from the start, bare over the top of the page and frosted once the list is
 * under it (`bar-scrolled`), the switch crossfaded by `nav-bar-fade`, sliding away as the content
 * scrolls down (SLIDE_AWAY_BAR). The title is the pushed pages' (`TopBar`): the system's text in
 * the system's slot, as a view, since UIKit registers a text title with the list's scroll edge
 * and draws that edge behind it over the strip, where every page here keeps that edge hidden.
 * A title that waited for the page's own to scroll under the bar was tried and taken out: the bar
 * has to hold something meanwhile, UIKit draws a blank or whitespace title as quotation marks,
 * and a bar with nothing collapses to no height where the back button sits in the Duo's vertical
 * bar.
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
}: {
  title: string;
  nativePush: boolean;
  onClose: () => void;
}) {
  const material = useBarMaterial();
  const scrolled = useBarScrolled();
  useManagesBar();
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerBlurEffect: scrolled ? material : 'none',
          headerBackVisible: nativePush,
          // Not a pushed card, nothing for UIKit to pop: the edge is the page's own back-swipe.
          gestureEnabled: nativePush,
          title,
          unstable_nativeProps: SLIDE_AWAY_BAR,
          scrollEdgeEffects: HIDDEN_TOP_EDGE,
        }}
      />
      <Stack.Title asChild>
        <ThemedText numberOfLines={1} style={barTitleStyle}>
          {title}
        </ThemedText>
      </Stack.Title>
      {NavBarFade ? <NavBarFade style={styles.probe} pointerEvents="none" onTrace={traceBar} /> : null}
      {!nativePush ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Go back" onPress={onClose} />
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

// TEMPORARY: the bar's switches, traced to Settings > Diagnostics (docs/NATIVE-HACKS.md, item 22).
function traceBar(e: { nativeEvent: { message: string } }) {
  logDiagnostic('bar-fade', e.nativeEvent.message);
}

const styles = StyleSheet.create({
  probe: { position: 'absolute', width: 0, height: 0 },
});
