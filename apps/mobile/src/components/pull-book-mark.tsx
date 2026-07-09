import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * The pull-to-refresh mark: the app's own open-book logo, animated by the pull itself instead of a
 * generic spinner. It's the `logo.svg` artwork rebuilt as three stacked layers so the parts can move
 * independently — the blue cover (static), the two facing pages, and the こ glyph:
 *
 * - **Pull opens the book.** As `pullY` climbs toward the threshold the two pages *splay open*
 *   (scaleX about the spine, the shared canvas centre) and the whole mark scales up — the gesture
 *   directly drives the art, landing fully open right as the trigger haptic fires.
 * - **こ inks in.** The glyph fades + rises into place over the same pull, so the logo "completes"
 *   as you reach the threshold.
 * - **Refreshing loops softly.** While the request runs the pages fan open/closed on a gentle
 *   breath, the mark bobs, and こ shimmers — a calm "working" state, not a frantic spin.
 *
 * Everything animates via plain View transforms over static SVG (no per-frame SVG prop animation),
 * so it behaves identically on iOS, Android, and web. Fed the same `pullY`/`refreshing` the old
 * `ActivityIndicator` got.
 */
export function PullBookMark({
  pullY,
  pullThreshold,
  refreshing,
  size = 40,
}: {
  pullY: SharedValue<number>;
  pullThreshold: number;
  refreshing: boolean;
  size?: number;
}) {
  // 0→1→0 yo-yo, only while refreshing — the source of the breathe / bob / shimmer loop. Idle at 0.
  const loop = useSharedValue(0);
  useEffect(() => {
    if (refreshing) {
      loop.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true);
    } else {
      cancelAnimation(loop);
      loop.value = withTiming(0, { duration: 220 });
    }
    return () => cancelAnimation(loop);
  }, [refreshing, loop]);

  // Openness driver, shared by every layer: the clamped pull ratio, pinned to 1 while refreshing.
  const bookStyle = useAnimatedStyle(() => {
    const base = refreshing ? 1 : Math.min(1, Math.max(0, pullY.value / pullThreshold));
    const bob = refreshing ? (loop.value - 0.5) * 3 : 0;
    return { transform: [{ scale: 0.82 + 0.18 * base }, { translateY: bob }] };
  }, [refreshing]);

  const pagesStyle = useAnimatedStyle(() => {
    const base = refreshing ? 1 : Math.min(1, Math.max(0, pullY.value / pullThreshold));
    const breathe = refreshing ? loop.value * 0.14 : 0;
    // Half-open at rest, fully splayed at the threshold; the breath eases it shut a touch on loop.
    return { transform: [{ scaleX: 0.5 + 0.5 * base - breathe }] };
  }, [refreshing]);

  const koStyle = useAnimatedStyle(() => {
    const base = refreshing ? 1 : Math.min(1, Math.max(0, pullY.value / pullThreshold));
    const shimmer = refreshing ? 0.65 + 0.35 * loop.value : 1;
    return { opacity: 0.58 * base * shimmer, transform: [{ translateY: (1 - base) * size * 0.14 }] };
  }, [refreshing, size]);

  return (
    <Animated.View style={[{ width: size, height: size }, bookStyle]}>
      {/* Cover — the book's blue back/spine, always shown; the pages open over it. */}
      <View style={StyleSheet.absoluteFill}>
        <Svg width={size} height={size} viewBox="0 0 1024 1024">
          <Defs>
            <LinearGradient id="pbm-cover" x1="109.5" y1="213.5" x2="914.5" y2="806.5" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#6EA8F7" />
              <Stop offset="1" stopColor="#3266DC" />
            </LinearGradient>
          </Defs>
          <Rect x="109.5" y="234.3" width="805" height="571.4" rx="64.8" fill="url(#pbm-cover)" />
        </Svg>
      </View>

      {/* Both facing pages, splayed together about the spine (canvas centre = transform origin). */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.pivotCenter, pagesStyle]}>
        <Svg width={size} height={size} viewBox="0 0 1024 1024">
          <Defs>
            <LinearGradient id="pbm-left" x1="160" y1="167.1" x2="512" y2="806.5" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.45" stopColor="#EAF6FF" />
              <Stop offset="1" stopColor="#93C5FD" />
            </LinearGradient>
            <LinearGradient id="pbm-right" x1="864" y1="167.1" x2="512" y2="806.5" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.45" stopColor="#DBEAFE" />
              <Stop offset="1" stopColor="#60A5FA" />
            </LinearGradient>
          </Defs>
          <Path
            d="M512 241.2 C425 186 288 178 192 202 C166 208.5 154 224 154 246 V728 C154 758 179 773 224 766 C340 748 432 763 512 804.4 V241.2 Z"
            fill="url(#pbm-left)"
          />
          <Path
            d="M512 241.2 C599 186 736 178 832 202 C858 208.5 870 224 870 246 V728 C870 758 845 773 800 766 C684 748 592 763 512 804.4 V241.2 Z"
            fill="url(#pbm-right)"
          />
        </Svg>
      </Animated.View>

      {/* こ — inks in over the pull. */}
      <Animated.View style={[StyleSheet.absoluteFill, koStyle]}>
        <Svg width={size} height={size} viewBox="0 0 1024 1024">
          <Defs>
            <LinearGradient id="pbm-ko" x1="700" y1="720" x2="320" y2="270" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#2563EB" />
              <Stop offset="0.55" stopColor="#3B82F6" />
              <Stop offset="1" stopColor="#BAE6FD" />
            </LinearGradient>
          </Defs>
          <Path
            d="M376.990234375 486.416015625Q396.27734375 496.181640625 415.564453125 506.435546875Q419.470703125 508.6328125 419.470703125 511.318359375Q419.470703125 513.02734375 418.005859375 515.46875Q404.822265625 535.48828125 404.822265625 553.5546875Q404.822265625 579.189453125 435.828125 590.17578125Q464.1484375 600.4296875 523.474609375 600.4296875Q592.810546875 600.4296875 658.97265625 586.025390625Q661.658203125 585.537109375 663.3671875 585.537109375Q668.25 585.537109375 669.470703125 590.6640625Q675.330078125 612.880859375 677.52734375 639.4921875Q677.52734375 640.224609375 677.52734375 640.46875Q677.52734375 645.595703125 668.982421875 647.060546875Q603.30859375 659.0234375 519.8125 659.0234375Q430.9453125 659.0234375 387.732421875 629.482421875Q350.37890625 603.84765625 350.37890625 557.94921875Q350.37890625 527.67578125 376.990234375 486.416015625ZM387.9765625 297.451171875Q442.6640625 310.390625 528.357421875 310.390625Q562.78125 310.390625 634.314453125 305.99609375Q635.291015625 305.99609375 635.779296875 305.99609375Q641.150390625 305.99609375 641.8828125 311.611328125Q644.32421875 330.654296875 644.32421875 354.091796875Q644.32421875 363.857421875 635.779296875 364.58984375Q576.94140625 373.37890625 513.46484375 414.150390625Q507.361328125 418.544921875 500.76953125 418.544921875Q495.642578125 418.544921875 490.271484375 415.615234375Q473.42578125 404.384765625 455.359375 399.501953125Q496.130859375 372.890625 520.7890625 357.998046875Q509.802734375 359.462890625 479.7734375 359.462890625Q439.978515625 359.462890625 392.37109375 350.91796875Q385.779296875 349.453125 385.779296875 341.7626953125Q385.779296875 334.072265625 387.9765625 297.451171875Z"
            fill="url(#pbm-ko)"
          />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Splay the pages about the shared canvas centre — which is the book's spine.
  pivotCenter: { transformOrigin: '50% 50%' },
});
