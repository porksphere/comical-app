import { Image } from 'expo-image';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';
import { LeavingMask } from '@/components/series/leaving-mask';
import type { ZoomRect } from '@/lib/series-zoom';

type AnimatedStyle = ComponentProps<typeof Animated.View>['style'];

/**
 * The zoom both series pages open and close through: THE MASK, the rounded window the page is seen
 * through, growing from the tapped card's box to the whole screen; THE PAGE inside it, scaled and
 * aligned so its own hero lands on that box; and THE FLYING THUMBNAIL (see `thumb`). At rest the
 * mask IS the screen, so it clips nothing that was ever visible.
 *
 * The page's transform and its fade are separate layers, so the thumbnail can ride the transform
 * without fading with it: the page's content is the half of the cross-fade that fades in, the
 * thumbnail the half that fades out.
 */
export function ZoomFrame({
  committing,
  leave,
  maskStyle,
  pageStyle,
  contentFadeStyle,
  width,
  height,
  thumb,
  children,
}: {
  committing: SharedValue<boolean>;
  leave: () => void;
  maskStyle: AnimatedStyle;
  /** Transform only, so the thumbnail can share it. */
  pageStyle: AnimatedStyle;
  contentFadeStyle: AnimatedStyle;
  width: number;
  height: number;
  /**
   * A copy of the tapped picture. The library moves the REAL source element on the screen
   * underneath; from inside a modal that view is untouchable. Laid out at the DESTINATION bound and
   * left to ride the page's transform, which keeps it honest: at rest that transform puts this rect
   * exactly on the tapped card, and at the end exactly on the page's own hero. No second geometry to
   * drift out of sync. The mask supplies the card's rounded silhouette.
   */
  thumb: { uri: string; rect: ZoomRect; style: AnimatedStyle; onPainted: () => void } | null;
  children: ReactNode;
}) {
  return (
    <LeavingMask committing={committing} leave={leave} style={[styles.zoomMask, maskStyle]}>
      {/* The page is pinned to the SCREEN's size, never the mask's, so a shrinking window crops it
          instead of reflowing it. */}
      <Animated.View style={[styles.zoomPage, { width, height }, pageStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, contentFadeStyle]}>{children}</Animated.View>
        {thumb && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.zoomThumb,
              { left: thumb.rect.x, top: thumb.rect.y, width: thumb.rect.width, height: thumb.rect.height },
              thumb.style,
            ]}>
            {/* onLoad/onError are what release the source card's blanking: until this view has
                pixels the real card underneath stands in for it. See `blankSource`. */}
            <Image
              source={{ uri: thumb.uri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              onLoad={thumb.onPainted}
              onError={thumb.onPainted}
            />
          </Animated.View>
        )}
      </Animated.View>
    </LeavingMask>
  );
}

const styles = StyleSheet.create({
  // Its whole box comes from the animated style (always explicit numbers), so a percentage base
  // can never race it. `overflow: hidden` is what makes it a mask rather than a rounded outline.
  zoomMask: {
    position: 'absolute',
    overflow: 'hidden',
  },
  zoomPage: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  zoomThumb: {
    position: 'absolute',
    overflow: 'hidden',
    // The card's own cover backing (series-card.tsx `coverBoxClip`), so a cover that hasn't
    // decoded yet reads as the same grey plate rather than a hole onto the page underneath.
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
});
