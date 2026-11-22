/**
 * A comment thread as a screen: the series' own, or one chapter's (`chapterId`). Opened by the
 * series page's Comments row and by a chapter row's menu. Nothing is asked of the source until it
 * opens.
 */
import { useRef } from 'react';
import { StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { CommentThread, type CommentThreadHandle } from '@/components/comments/comment-thread';
import { ScreenScrollView } from '@/components/screen-scroll-marker';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useLocalSearchParams } from '@/lib/nav';

/** How close to the end (in points) the next comments are asked for. */
const NEAR_END = 600;

export type SeriesCommentsParams = {
  bridgeId?: string;
  /** The series id. */
  id?: string;
  chapterId?: string;
  /** The chapter's name, which is the bar's title for a chapter's thread. */
  chapterName?: string;
  /** The count the series or chapter list came with, when it came with one. */
  count?: string;
};

export default function SeriesCommentsScreen() {
  const { bridgeId, id, chapterId, chapterName, count } = useLocalSearchParams<SeriesCommentsParams>();
  const padding = useSettingsScrollPadding(MaxContentWidth);
  const thread = useRef<CommentThreadHandle>(null);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    if (contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_END) thread.current?.loadMore();
  };
  const hint = count !== undefined && count !== '' ? Number(count) : NaN;

  return (
    <ThemedView style={styles.container}>
      <TopBar title={chapterId && chapterName ? chapterName : 'Comments'} />
      <ScreenScrollView testID="comments.scroll" onScroll={onScroll} scrollEventThrottle={64} contentContainerStyle={[styles.content, padding]}>
        {bridgeId && id ? (
          <CommentThread
            ref={thread}
            bridgeId={bridgeId}
            seriesId={id}
            {...(chapterId && { chapterId })}
            {...(Number.isFinite(hint) && { countHint: hint })}
          />
        ) : null}
      </ScreenScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
