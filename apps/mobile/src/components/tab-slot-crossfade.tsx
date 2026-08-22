import { Navigator } from 'expo-router';
import { TabContext, type TabsContextValue } from 'expo-router/ui';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Screen, ScreenContainer } from 'react-native-screens';

import { useTheme } from '@/hooks/use-theme';

/**
 * How long the incoming tab takes to fade in. iOS's own tab crossfade is over almost before you
 * register it as an animation — long enough that the swap isn't a cut, short enough that the tap
 * still feels instant. Past ~200ms it starts reading as a transition you have to wait out, which on
 * a bar you tap dozens of times a session is worse than the hard cut this replaces.
 *
 * Linear, unlike every other animation in the app (the bars all settle on `settleEase`). A settle
 * curve is right for a gesture hand-off — the bar leaves at the speed the finger left it and
 * decelerates into place. A crossfade has no gesture behind it, and an eased opacity ramp makes the
 * blend lopsided: ease-out dumps most of the incoming screen in the first few frames and then
 * crawls, so the two screens are never really mixed, the switch just cuts early and then waits.
 *
 * `ReduceMotion.System` honours the OS setting for free — with it on Reanimated lands the value
 * immediately, degrading this to the instant swap it replaces rather than to a slow fade.
 */
const CROSSFADE = {
  duration: 140,
  easing: Easing.linear,
  reduceMotion: ReduceMotion.System,
} as const;

/** react-native-screens' three activity states, named — see `RNSScreenContainer.mm`. */
const INACTIVE = 0;
const BELOW_TOP = 1;
const ON_TOP = 2;

/** expo-router's own default, kept verbatim: native screens everywhere they exist. */
const DETACH_INACTIVE_SCREENS = ['android', 'ios', 'web'].includes(Platform.OS);

/**
 * The tab content slot, crossfading between tabs instead of cutting.
 *
 * A replacement for expo-router's `<TabSlot />`, not a wrapper around it, because the cut is
 * structural: `defaultTabsSlotRender` gives the focused screen `display: 'flex'` and every other one
 * `display: 'none'`, so exactly one tab is ever on screen and there is nothing to fade FROM. Two
 * screens have to be visible at once for a frame or two, and that turns out to be decided three
 * layers down:
 *
 * - `useTabSlot` hardcodes `hasTwoStates: true` on its `ScreenContainer`, and drops any prop it
 *   wasn't destructured for, so it can't be talked out of that mode from the outside.
 * - `hasTwoStates` picks `RNSScreenNavigationContainer` on iOS, whose `updateContainer` does
 *   `setViewControllers:@[screen.controller]` — one view controller, by construction. A second
 *   screen at `BELOW_TOP` isn't drawn dimly or behind; it isn't in the hierarchy at all.
 * - `hasTwoStates: false` gets `RNSScreenContainerView` instead, which attaches every screen that
 *   isn't `INACTIVE` and has an explicit `BELOW_TOP` path for exactly this case ("mimic the effect
 *   UINavigationController has when willMoveToWindow:nil is triggered before the animation starts").
 *
 * So this rebuilds the slot on `Navigator.useContext()` — the same navigator state and descriptors
 * `useTabSlot` reads — and keeps everything else it did: the lazy `loaded` bookkeeping, the
 * `TabContext` provider per screen, `unmountOnBlur`/`freezeOnBlur`, and native detaching of every
 * tab not involved in the fade. It's also how `@react-navigation/bottom-tabs` implements its own
 * `animation: 'fade'` (`BottomTabView` flips `hasTwoStates` off the moment any route animates), so
 * this is a supported configuration of react-native-screens rather than a trick played on it.
 *
 * Only the INCOMING screen animates: it fades 0→1 over the outgoing one, which is held at full
 * opacity underneath until the fade lands. Crossfading both — the react-navigation preset — puts
 * them at 0.5 each mid-transition, and since a tab screen paints no background of its own that dips
 * through to the root Stack's, flashing an empty page in the middle of the switch. Fading one over
 * the other composites to `a·incoming + (1−a)·outgoing` with nothing showing through, which is what
 * a crossfade is supposed to look like.
 *
 * That only holds if the incoming screen IS opaque, hence the `theme.background` each one is painted
 * with below. At rest it's the same colour the root Stack already paints under every tab, so it
 * changes nothing anyone can see.
 */
export function CrossfadeTabSlot({ style }: { style?: StyleProp<ViewStyle> }) {
  // `Navigator.useContext()` is the generic navigator context — its descriptors are typed with
  // `object` options, because a Navigator doesn't know which one it is. Inside `<Tabs>` they are
  // always tab options; that's the same assumption expo-router itself makes when `useTabSlot` hands
  // a descriptor straight to `defaultTabsSlotRender`, which is typed to take a `TabsDescriptor`.
  // Narrowed once here so nothing below has to be cast.
  const { state, descriptors } = Navigator.useContext() as unknown as TabsContextValue;
  const theme = useTheme();
  const focusedKey = state.routes[state.index].key;

  // Lazy screens, exactly as `useTabSlot` tracks them: a tab is built the first time it's navigated
  // to, and stays built after.
  const [loaded, setLoaded] = useState<Record<string, boolean>>({ [focusedKey]: true });
  if (!loaded[focusedKey]) {
    setLoaded({ ...loaded, [focusedKey]: true });
  }

  // The tab the app opened on. It's the one screen that must NOT fade in — a launch should land on
  // the home tab, not dissolve into it — so it's the only one born already opaque.
  const [launchKey] = useState(focusedKey);

  // The crossfade in flight: which tab is being faded out from under the incoming one, and an id
  // identifying this particular switch. Derived from the focused key changing between renders, and
  // kept in state rather than a ref on purpose (see AGENTS.md): React may discard a render, and a ref
  // advanced during one that got thrown away would leave the retry thinking the tab never changed —
  // i.e. the one switch that silently doesn't fade.
  //
  // The id is what makes ending a transition safe. A fade ends by calling back from the UI thread,
  // and a screen can have an animation still outstanding from an earlier switch — Reanimated fires
  // those callbacks too. Without an id to check them against, the FIRST callback to arrive ends
  // whatever transition happens to be running: the outgoing screen was detached before the incoming
  // one had faded in at all, turning the crossfade into a fade up from an empty page. (Measured, not
  // theorised — a switch cleared `leaving` one render after setting it, before a single frame of the
  // fade.) An id turns a stale callback into a no-op.
  const [previousKey, setPreviousKey] = useState(focusedKey);
  const [transition, setTransition] = useState<{ id: number; leaving: string } | null>(null);
  if (previousKey !== focusedKey) {
    setPreviousKey(focusedKey);
    setTransition((current) => ({ id: (current?.id ?? 0) + 1, leaving: previousKey }));
  }

  // Let the outgoing screen detach — but only at the end of the fade that is actually covering it.
  // Stable, so a screen's fade isn't restarted by the re-render that starts it.
  const endTransition = useCallback((id: number) => {
    setTransition((current) => (current?.id === id ? null : current));
  }, []);

  return (
    // `hasTwoStates={false}` is the whole point — see the note above. On Android both branches
    // resolve to the same native container, so in practice this is an iOS-only change.
    <ScreenContainer enabled={DETACH_INACTIVE_SCREENS} hasTwoStates={false} style={[styles.container, style]}>
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        const { lazy = true, unmountOnBlur, freezeOnBlur } = descriptor.options;
        const isFocused = state.index === index;
        // Alive for one crossfade past losing focus, then detached like any other blurred tab.
        const isLeaving = transition?.leaving === route.key;

        if (unmountOnBlur && !isFocused && !isLeaving) return null;
        // Never navigated to: nothing to render, and nothing to fade either.
        if (lazy && !loaded[route.key] && !isFocused) return null;

        return (
          <TabContext.Provider key={route.key} value={descriptor.options}>
            <CrossfadeScreen
              isFocused={isFocused}
              isLeaving={isLeaving}
              // Non-null only for the screen that has something to fade over. A tab arriving with no
              // outgoing screen under it (the launch tab) has nothing to cross to, and fading it up
              // from the empty page is the artefact this whole component exists to avoid.
              fadeId={isFocused && transition ? transition.id : null}
              initialOpacity={route.key === launchKey ? 1 : 0}
              freezeOnBlur={freezeOnBlur}
              background={theme.background}
              onFaded={endTransition}>
              {descriptor.render()}
            </CrossfadeScreen>
          </TabContext.Provider>
        );
      })}
    </ScreenContainer>
  );
}

/**
 * One tab's screen, owning its own opacity.
 *
 * Per-screen rather than one "fade progress" shared by the slot, because the value has to be right
 * on the very render that changes focus. A single value would have to be reset to 0 by the effect
 * that starts the animation — which runs AFTER the incoming screen has been committed at whatever
 * the last transition left behind, i.e. one frame of the new tab at full opacity before it drops to
 * nothing and fades back in. A screen's own opacity is already 0 the whole time it sits off screen,
 * so the first frame it is focused is already the first frame of its fade, with no reset involved.
 */
function CrossfadeScreen({
  children,
  isFocused,
  isLeaving,
  fadeId,
  initialOpacity,
  freezeOnBlur,
  background,
  onFaded,
}: {
  children: ReactNode;
  isFocused: boolean;
  isLeaving: boolean;
  fadeId: number | null;
  initialOpacity: number;
  freezeOnBlur: boolean | undefined;
  background: string;
  onFaded: (id: number) => void;
}) {
  const opacity = useSharedValue(initialOpacity);
  const detached = !isFocused && !isLeaving;

  useEffect(() => {
    if (fadeId === null) return;
    opacity.set(
      withTiming(1, CROSSFADE, (finished) => {
        'worklet';
        // Only a fade that actually landed may release the screen underneath — and only its own
        // switch, which is what the id it was started with says. Unfinished means this fade was
        // overridden: the tab lost focus mid-fade and was snapped solid, or a newer switch took over.
        if (finished) runOnJS(onFaded)(fadeId);
      }),
    );
  }, [fadeId, onFaded, opacity]);

  useEffect(() => {
    // Now the one being faded over. Already opaque in the ordinary case (it's the tab you were just
    // looking at) so this is a no-op; it only bites when a third tab is tapped mid-fade, and
    // snapping a half-faded screen to solid is a far smaller artefact than letting the new fade run
    // against the empty page behind it.
    if (isLeaving) opacity.set(1);
  }, [isLeaving, opacity]);

  useEffect(() => {
    // Detached: invisible either way, and its next fade has to start from nothing. Without this a
    // tab abandoned mid-crossfade would come back with a hard cut, since it never reached 0.
    if (detached) opacity.set(0);
  }, [detached, opacity]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Screen
      enabled={DETACH_INACTIVE_SCREENS}
      activityState={isFocused ? ON_TOP : isLeaving ? BELOW_TOP : INACTIVE}
      freezeOnBlur={freezeOnBlur}
      shouldFreeze={detached}
      // Absolutely positioned rather than `flex: 1`, because for the length of a crossfade there are
      // two laid-out screens in this container and flex children would take half the height each.
      // The focused one is lifted above the screen it's fading over.
      style={[StyleSheet.absoluteFill, { zIndex: isFocused ? 1 : 0 }]}>
      <Animated.View
        // The outgoing screen is still on screen and still hit-testable for these few frames; a tap
        // landing on it would go to the tab you just left.
        pointerEvents={isFocused ? 'auto' : 'none'}
        style={[styles.screen, { backgroundColor: background }, fadeStyle]}>
        {children}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // `useTabSlot`'s own container sizing, kept verbatim — it's tuned for this exact slot, and the
  // screens inside it changing from in-flow to absolute doesn't change what the box has to do.
  container: {
    flexShrink: 0,
    flexGrow: 1,
  },
  screen: {
    flex: 1,
  },
});
