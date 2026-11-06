import { observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { BlurView } from 'expo-blur';
import { use, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { HeaderHeightContext } from 'expo-router/build/react-navigation/elements/Header/HeaderHeightContext.js';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBarRow, useBarScrolled, useManagesBar, type BarRow } from '@/components/bar-scrolled';
import { HoldActionTarget } from '@/components/hold-action-target';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSideInsets } from '@/hooks/use-content-width';
import { NATIVE_HEADER, useTopChromeHeight } from '@/hooks/use-native-header';
import { logDiagnostic } from '@/lib/diagnostics';
import { useActiveColorScheme } from '@/hooks/use-theme';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

/**
 * A tab's title on iOS, where the system bar holds no title: on the bar's own row, beside its
 * glass items, the way the TV app's is, pinned there and rising away, fading and blurring, as the
 * list scrolls under it, the way the bar's items go when the bar slides away; never riding the
 * list (a pull to refresh leaves it put). Laid over the screen, not in the list, so every tab's
 * sits at the same inset whatever its list pads. Also the tab's NSFW hold target, as the bar's
 * title was. Nothing elsewhere: the custom bars carry the title.
 *
 * The row is the bar's content extent, reported by the list's anchor (`useBarRow`): the bar's
 * frame on the folded Duo starts 24pt down under a strip at the top of the panel, but its content
 * view reaches up to the top and its items centre on that. A bar emptied by the side bar (its
 * items taken in) collapses, so the row of the last full bar seen stands in for it. Until any
 * report, the window's top inset and the chrome height place it, which is that extent too. The
 * content below starts at the chrome height plus `BarContentGap` on every tab; the Settings form,
 * whose inset is UIKit's, adds that gap itself.
 *
 * The way out is timed off the screen's bar-scrolled state, the crossing the list's anchor
 * reports a few points down, either way (`bar-scrolled`, `'heading'`), which this manages: the
 * one signal every list gives, the SwiftUI form's included, and the way the bar's own slide is
 * run. The glyphs are
 * centred on the row by their own measure: the text reports its ascender and cap height, and the
 * box shifts by the distance from the capitals' middle to its own.
 */
export function TabLargeTitle({ title, holdTestID }: { title: string; holdTestID: string }) {
  const chrome = useTopChromeHeight();
  const insets = useSafeAreaInsets();
  const sides = useSideInsets();
  const scheme = useActiveColorScheme();
  const reported = use(HeaderHeightContext) ?? 0;
  const ownRow = useBarRow();
  const fullRow = useSelector(barMemory$.fullRow);
  useEffect(() => {
    if (ownRow && ownRow.height >= FULL_BAR_MIN) barMemory$.fullRow.set(ownRow);
  }, [ownRow]);
  const row =
    ownRow && ownRow.height >= FULL_BAR_MIN ? ownRow : (fullRow ?? { top: insets.top, height: chrome - insets.top });
  useManagesBar(true, 'heading');
  const scrolled = useBarScrolled();
  // 0 at rest, 1 gone, on a timer at the crossing.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withTiming(scrolled ? 1 : 0, { duration: AWAY_MS }));
  }, [scrolled, progress]);
  // The capitals' middle against the line box's: the box is centred on the row, the glyphs then
  // moved so their visual centre is.
  const [capShift, setCapShift] = useState(0);
  const onLine = (line: { ascender: number; capHeight: number; height: number } | undefined) => {
    if (!line) return;
    setCapShift(line.ascender - line.capHeight / 2 - line.height / 2);
  };
  // TEMPORARY: the row and its inputs, to Settings > Diagnostics and Metro.
  useEffect(() => {
    logDiagnostic(
      'bar-title',
      `${title}: row ${row.top}+${row.height} cap shift ${capShift.toFixed(1)} scrolled ${scrolled} | chrome ${chrome} reported ${reported} inset ${insets.top} own ${ownRow ? `${ownRow.top}+${ownRow.height}` : 'none'}`,
    );
  }, [title, row.top, row.height, capShift, scrolled, chrome, reported, insets.top, ownRow]);
  const away = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: -capShift - progress.value * row.height * 0.5 }],
  }));
  const blur = useAnimatedProps(() => ({ intensity: progress.value * BLUR_AWAY }));
  if (!NATIVE_HEADER) return null;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.row,
        { top: row.top, height: row.height, paddingLeft: sides.left + Spacing.three, paddingRight: sides.right + Spacing.three },
        away,
      ]}>
      <HoldActionTarget testID={holdTestID} label={title}>
        {/* Room around the text for the blur, which a blur view clips at its own edges. */}
        <View style={styles.blurRoom}>
          <ThemedText numberOfLines={1} style={styles.title} onTextLayout={(e) => onLine(e.nativeEvent.lines[0])}>
            {title}
          </ThemedText>
          {/* Over the text: blurs it as it goes, nothing at rest (intensity 0 is no view at all). */}
          <AnimatedBlurView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            tint={scheme === 'dark' ? 'dark' : 'light'}
            animatedProps={blur}
          />
        </View>
      </HoldActionTarget>
    </Animated.View>
  );
}

/** The last full row any tab's bar had, for a tab whose bar has nothing in it and has collapsed. */
const barMemory$ = observable<{ fullRow: BarRow | null }>({ fullRow: null });
// Below UIKit's smallest bar, the row is a bar with nothing in it.
const FULL_BAR_MIN = 40;
const BLUR_AWAY = 40;
const AWAY_MS = 300;
// What the blur may spread past the glyphs.
const BLUR_ROOM = 16;

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  blurRoom: {
    padding: BLUR_ROOM,
    margin: -BLUR_ROOM,
  },
  // A line box with room for the glyphs (ThemedText's default type sets a 24pt line height, which
  // clipped the tops of these); where the glyphs sit in it is measured, above.
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
