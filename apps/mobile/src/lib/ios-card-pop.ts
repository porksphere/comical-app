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
 * The two mistakes this module exists to stop being made again, both of which read to a user as
 * "this isn't the system gesture":
 *
 *  1. Testing velocity as a SEPARATE threshold. The obvious rule — commit past 25% of the width OR
 *     over 900px/s — is a cliff: everything slower than a proper flick contributes exactly nothing,
 *     so a fast, short throw is rejected outright and springs back. UIKit doesn't test velocity, it
 *     SPENDS it. `iosPopCommitted` projects the release along its own velocity and asks where that
 *     lands, so distance and speed are one currency (at 0.3s, 900px/s buys 270px of travel).
 *
 *  2. Releasing into a fixed curve. A duration-and-easing animation takes the current value and
 *     interpolates from it, discarding the speed the finger was moving at — which is the difference
 *     between the screen continuing and the screen playing back a recording of itself. Every
 *     animation here is the spring below, handed the gesture's velocity.
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

/** How far a release is projected along its velocity, in seconds (GESTURE_VELOCITY_IMPACT). */
export const IOS_VELOCITY_IMPACT = 0.3;

/** How far the screen UNDERNEATH drifts while a card covers it (`forHorizontalIOS`: -30%, not -100%). */
export const IOS_PARALLAX_FRACTION = 0.3;

/**
 * Did this release commit the pop? `distance` is the axis the card travels along (the screen width
 * for a horizontal pop).
 */
export function iosPopCommitted(translation: number, velocity: number, distance: number): boolean {
  'worklet';
  return translation + velocity * IOS_VELOCITY_IMPACT > distance / 2;
}

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
