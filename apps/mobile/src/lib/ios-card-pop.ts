import { Platform, type ViewStyle } from 'react-native';

/**
 * UIKit's card push/pop, for a surface that has to recreate it.
 *
 * Inside the series page's contained transparent modal there is no native stack to borrow from, so
 * a layer that arrives by sliding in from the edge (the tag/author search — see SearchLayer) has to
 * reproduce the transition itself. These are react-navigation's own numbers rather than anything
 * tuned by hand, which is the point: it is the best-tested model of the real thing available to
 * copy, and matching it exactly is the goal. Do not "improve" them.
 *
 * The mistake this module exists to stop being made again: releasing into a FIXED CURVE. A
 * duration-and-easing animation takes the current value and interpolates from it, discarding the
 * speed the finger was moving at — the difference between the screen continuing and the screen
 * playing back a recording of itself. Every animation here is the spring below, handed the
 * gesture's velocity.
 *
 * The other half of feeling native — deciding whether a release committed at all — is not here,
 * because it is not specific to a card pop. See lib/gesture-release.
 */

/** `TransitionIOSSpec` — the spring react-navigation models UIKit's card transition with. */
export const IOS_CARD_SPRING = {
  stiffness: 1000,
  damping: 500,
  mass: 3,
  overshootClamping: true,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
} as const;

/** How far the screen UNDERNEATH drifts while a card covers it (`forHorizontalIOS`: -30%, not -100%). */
export const IOS_PARALLAX_FRACTION = 0.3;

/**
 * The shadow UIKit draws down the leading edge of a pushed card, over the screen it covers. Without
 * it the card reads as a flat swap rather than something on top.
 *
 * iOS only: Android's `elevation` is omnidirectional and its own push transition carries nothing
 * like this. The card MUST also have an opaque background — that is load-bearing, not decoration.
 * With no background, iOS derives the shadow's shape from the subtree's alpha on every frame of the
 * drag, and a card is the size of the screen.
 */
export const IOS_CARD_SHADOW: ViewStyle = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: -3, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  default: {},
});
