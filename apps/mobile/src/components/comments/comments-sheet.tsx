import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { CommentThread, type CommentThreadHandle } from '@/components/comments/comment-thread';
import { OverlayHeading, useSheetScroll } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useWindowSize } from '@/hooks/use-window-size';

const AnimatedScrollView = Animated.createAnimatedComponent(GHScrollView);

const NEAR_END = 400;
/** The thread's share of the window: tall enough to read in, short enough that the page behind
 *  the sheet is still there to go back to. */
const HEIGHT_SHARE = 0.62;

/**
 * A chapter's comments over the reader, as overlay content (`useOverlay().openDialog`): a sheet on
 * a phone, a dialog on a wide window. A sheet rather than a page so the reader under it never
 * leaves, and the place in the chapter is still there when it closes.
 *
 * Its scroller reports to the sheet (`useSheetScroll`), so a pull down at the top of the thread
 * goes on to dismiss it.
 */
export function CommentsSheet({
  bridgeId,
  seriesId,
  chapterId,
  name,
}: {
  bridgeId: string;
  seriesId: string;
  chapterId?: string;
  /** The chapter's name, under the heading. */
  name?: string;
}) {
  const { height } = useWindowSize();
  const sheet = useSheetScroll();
  const thread = useRef<CommentThreadHandle>(null);
  const localOffset = useSharedValue(0);
  const offset = sheet?.scrollOffset ?? localOffset;
  const loadMore = () => thread.current?.loadMore();
  const onScroll = useAnimatedScrollHandler((e) => {
    offset.set(e.contentOffset.y);
    if (e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < NEAR_END) runOnJS(loadMore)();
  });
  return (
    <View testID="comments.sheet" style={styles.sheet}>
      <View>
        <OverlayHeading>Comments</OverlayHeading>
        {!!name && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {name}
          </ThemedText>
        )}
      </View>
      <AnimatedScrollView
        ref={sheet?.scrollRef as never}
        onScroll={onScroll}
        scrollEventThrottle={32}
        style={{ maxHeight: Math.round(height * HEIGHT_SHARE) }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <CommentThread ref={thread} bridgeId={bridgeId} seriesId={seriesId} {...(chapterId && { chapterId })} />
      </AnimatedScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    gap: Spacing.three,
  },
  content: {
    paddingBottom: Spacing.three,
  },
});
