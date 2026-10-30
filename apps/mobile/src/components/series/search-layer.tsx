import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  makeMutable,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { isDesktopPointer } from '@/components/reader/desktop-zoom';
import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { useTheme } from '@/hooks/use-theme';
import {
  backSwipePan,
  backSwipeShape,
  backSwipeStayedHorizontal,
  resetBackSwipeShape,
  trackBackSwipeShape,
} from '@/lib/back-swipe';
import { trace, traceGate, traceThrottled, useGestureTraceEnabled } from '@/lib/gesture-trace';
import { releaseCommitted } from '@/lib/gesture-release';
import { IOS_CARD_SHADOW, IOS_CARD_SPRING } from '@/lib/ios-card-pop';
import { useSeriesPaneWidth } from '@/lib/series-pane-context';
import SearchScreen from '@/app/search';
import { DISMISS_COMMIT_FRACTION } from '@/components/series/page-motion';
import { useViewport } from '@/components/series/viewport';

const IS_WEB = Platform.OS === 'web';

/** See the SearchLayer's `Stack.Screen`. */
const SEARCH_LAYER_BAR = { headerShown: false } as const;

/**
 * The tag/author/type search as a LAYER over the series instances — the same mechanics as a
 * drilled series (slide-in riding edgeX, the edge back-swipe rig, Android hardware back), with
 * the search screen embedded (its back button becomes a spacer) and the shared chevron rendered
 * statically stuck above the slide, fading on edgeX — in the exact spot the series bars beneath
 * keep theirs, so the chevron never moves through the navigation. The search's result cards
 * drill further series layers on top (useDrillRelatedSeries works unchanged inside).
 */
export function SearchLayer({
  onPopLayer,
  coverSV,
  isTop,
}: {
  onPopLayer: () => void;
  /** See SeriesRoute's `layerCover` — the parallax this layer drives on the series beneath it. */
  coverSV?: SharedValue<number>;
  isTop?: boolean;
}) {
  const { width } = useViewport();
  const theme = useTheme();
  // In the desktop pane a tag's search simply replaces the page, the way the pane's own navigation
  // does: a push sliding in from the edge is a phone's idiom, and there it is a sideways ride
  // across most of the window for every chip clicked.
  const inPane = useSeriesPaneWidth() !== null;
  const edgeX = useSharedValue(inPane ? 0 : width);
  const edgeCommitting = useSharedValue(false);
  // Set the moment the back-swipe activates: the results list stops scrolling for as long as this
  // layer is being dragged out. See the note in the pan's onStart.
  const [swipeLocked, setSwipeLocked] = useState(false);
  useEffect(() => {
    if (!inPane) edgeX.set(withSpring(0, IOS_CARD_SPRING));
    // Mount-only entrance — edgeX is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // No swipe-away here (the search has no reader to fling), so coverage is purely the slide.
  useAnimatedReaction(
    () => 1 - Math.min(1, Math.max(0, edgeX.value / width)),
    (cover) => {
      if (isTop && coverSV) coverSV.set(cover);
    },
    [width, isTop, coverSV],
  );
  // Both exits (the chevron/hardware back below, and a committed swipe) run through here, so the
  // button and the gesture leave on the same curve — as they do on a native stack, where the pop
  // animation doesn't know which one asked for it.
  //
  // `edgeCommitting` is the guard, and it is the right one for two jobs at once: it already means
  // "this layer is leaving" and is one-way for the layer's whole life, so checking it here makes a
  // second exit a no-op — the chevron tapped during a committed swipe, say — so exactly one spring
  // exists, hence exactly one pop.
  // `onPopLayer` slices this layer off the stack; a second call would take another layer with it.
  //
  // And the pop fires REGARDLESS of `finished`. A cancelled animation reports finished:false, and
  // a callback that leaves only on true would strand the layer off-screen — mounted, invisible,
  // still in `drills`. That exact shape is what made the series page's release end instantly, in
  // the other direction.
  const slideOut = useCallback(
    (velocity: number) => {
      'worklet';
      trace('search.slideOut', 'commit', { v: velocity, edgeX: edgeX.value, already: edgeCommitting.value });
      if (edgeCommitting.value) return;
      edgeCommitting.set(true);
      edgeX.set(
        withSpring(width, { ...IOS_CARD_SPRING, velocity }, (finished) => {
          trace('search.slideOut', 'done', { finished: !!finished, edgeX: edgeX.value });
          runOnJS(onPopLayer)();
        }),
      );
    },
    [edgeX, edgeCommitting, width, onPopLayer],
  );
  const closeLayer = useCallback(() => {
    if (!inPane) return runOnUI(slideOut)(0);
    if (edgeCommitting.get()) return;
    edgeCommitting.set(true);
    onPopLayer();
  }, [slideOut, inPane, edgeCommitting, onPopLayer]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [closeLayer]);
  // Escape, as on the series layers (see SeriesDetailsPage) — top layer only.
  useEffect(() => {
    if (!IS_WEB || !isTop || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      e.preventDefault();
      closeLayer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTop, closeLayer]);
  // The back-swipe. Activation is the shared one (lib/back-swipe) — literally the same code the
  // series instance runs, which is the point: two surfaces that both claim to have a back-swipe
  // must agree on what one is. Everything after it is this layer's own, because here a back-swipe
  // slides a card out rather than collapsing a gallery.
  //
  // One copy per platform, exactly as on the instance: the native one rides the results scroller
  // composed with a Native handler (`Gesture.Simultaneous`, one detector — see there for why the
  // cross-detector relation isn't trusted), the web one sits at screen level. `ranHere` and the
  // one-way `edgeCommitting` come across from there too — the first so a drag that never activated
  // can't settle or unlock anything, the second so nothing can undo a commit and drag the layer
  // back on screen after it has already been sliced off the stack.
  const makeBackSwipePan = useCallback((tag: string) => {
    const updateGate = traceGate();
    const ranHere = makeMutable(false);
    // Where the finger was at ACTIVATION — see the instance's copy for why. RNGH measures
    // translation from touch-down, so without this the card jumps by however far the rule spent
    // deciding, and a late activation leaves the release nothing to animate. Y is tracked only to
    // judge the release: nothing here follows the finger vertically.
    const originX = makeMutable(0);
    const originY = makeMutable(0);
    // The cancel carries the release velocity too — let go while still moving right and the
    // screen eases out of that motion before coming back, rather than reversing on the spot.
    const settle = (velocity: number) => {
      'worklet';
      edgeX.set(withSpring(0, { ...IOS_CARD_SPRING, velocity }));
    };
    // See the instance's copy — the opening stretch decides whether this is a back-swipe.
    const qualified = backSwipeShape();
    return backSwipePan(tag)
      .onStart((e) => {
        'worklet';
        trace(tag, 'START', { tx: e.translationX, ty: e.translationY });
        ranHere.set(true);
        originX.set(e.translationX);
        originY.set(e.translationY);
        resetBackSwipeShape(qualified);
        // Activation means this gesture owns the screen — the results list must STOP SCROLLING
        // under it. Without this the page kept scrolling vertically while sliding out sideways,
        // which is the single thing that gave the layer away as not-a-real-push: a card being
        // popped is inert, it doesn't keep responding to a finger that has moved on to dismissing
        // it. The series page's own back-swipe has always done this (`swipeLocked`).
        runOnJS(setSwipeLocked)(true);
      })
      .onUpdate((e) => {
        'worklet';
        const tx = e.translationX - originX.value;
        traceThrottled(updateGate, 60, tag, 'update', { tx, edgeX: edgeX.value });
        trackBackSwipeShape(qualified, tx, e.translationY - originY.value);
        edgeX.set(Math.max(0, tx));
      })
      .onEnd((e) => {
        'worklet';
        // Where the swipe was HEADED, not where it stopped — see lib/gesture-release.
        // A card pop IS a dismissal, so it takes the same bar — half the travel, which is also
        // what react-navigation uses for this exact transition.
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        trace(tag, 'END', { tx, ty, vx: e.velocityX, vy: e.velocityY, shape: qualified.value, edgeX: edgeX.value, committing: edgeCommitting.value, ran: ranHere.value });
        // Same two questions as the instance's release — a card pop is a back-swipe too, and a
        // drag that opened off-axis is not one however far across it got.
        if (
          backSwipeStayedHorizontal(tx, ty, e.velocityX, e.velocityY, qualified) &&
          releaseCommitted(tx, e.velocityX, width * DISMISS_COMMIT_FRACTION)
        )
          slideOut(e.velocityX);
        else settle(e.velocityX);
      })
      .onFinalize((_e, success) => {
        'worklet';
        trace(tag, 'FINALIZE', { ok: !!success, ran: ranHere.value, committing: edgeCommitting.value, edgeX: edgeX.value });
        // Only the copy that was DRIVING settles, and only a drag that never reached onEnd —
        // see the instance's copy for why this asks `success` rather than the commit latch.
        if (ranHere.value && !success) settle(0);
        // …and only that copy may unlock the list, for the same reason.
        if (ranHere.value) runOnJS(setSwipeLocked)(false);
        ranHere.set(false);
      });
  }, [width, edgeX, edgeCommitting, slideOut]);
  // See the series instance's copy for why the trace flag is a rebuild dep.
  const traceOn = useGestureTraceEnabled();
  // Web only, exactly as on the series instance — this layer had the same two-copy arrangement, an
  // ancestor detector and a descendant one both reaching for the same touch with the same criteria
  // and cancelling each other at the activation frame. The results list carries the native copy.
  // Not under a mouse: RNGH hears its drags too, and a desktop has the back button for this.
  const edgePan = useMemo(
    () => makeBackSwipePan('search.edge').enabled(IS_WEB && !isDesktopPointer()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, traceOn],
  );
  const scrollGesture = useMemo(
    () => (IS_WEB ? undefined : Gesture.Simultaneous(Gesture.Native(), makeBackSwipePan('search.list'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, traceOn],
  );
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: edgeX.value }] }));
  // `isTop` matters for more than looks: it is how the embedded search knows to ignore an intent
  // meant for a layer above it (see the subscription in search.tsx).
  const embedded = useMemo(
    () => ({ onBack: closeLayer, scrollGesture, isTop: !!isTop, scrollEnabled: !swipeLocked }),
    [closeLayer, scrollGesture, isTop, swipeLocked],
  );
  return (
    <View style={styles.container}>
      {/* iOS: the search draws its own bar, so the route's system bar (the series' below) goes
          while this layer is top; the series re-applies its own when it is top again. */}
      {NATIVE_HEADER && isTop ? <Stack.Screen options={SEARCH_LAYER_BAR} /> : null}
      <GestureDetector gesture={edgePan}>
        <Animated.View style={[styles.searchSlide, { backgroundColor: theme.background }, slideStyle]}>
          <SearchScreen embedded={embedded} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Transparent: the route is a contained transparent modal — the details layer is the opaque
    // fill, and a dismissal fades it out over the screen beneath (see dismissFadeStyle).
    backgroundColor: 'transparent',
  },
  // The SEARCH layer's slide-in ride — the one layer that still arrives as a push (see SearchLayer).
  searchSlide: {
    flex: 1,
    // The pushed-card shadow, and the opaque fill it needs — see lib/ios-card-pop.
    ...IOS_CARD_SHADOW,
  },
});
