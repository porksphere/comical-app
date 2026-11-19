import { useInfiniteQuery } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import { useImperativeHandle, useState, type Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { SourceTabs } from '@/components/catalog-search';
import { CommentCard, type ThreadContext } from '@/components/comments/comment-card';
import { CaretDownIcon, OpenExternalIcon } from '@/components/icons/ui-icons';
import { OptionMenu, OptionRow } from '@/components/overlay/option-menu';
import { OptionList, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { RetryBlock } from '@/components/retry-block';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCommentCount, mergeCommentPages, sortControlFor } from '@/data/comments';
import { useThreadSort } from '@/data/comments-prefs';
import { commentsQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { testId } from '@/lib/test-id';

/** What the scroller around a thread calls as its end comes near. */
export type CommentThreadHandle = { loadMore: () => void };

/**
 * How many comments are drawn at first, and how many more each time the end is reached. Most
 * sources page in twenties and never meet it; it is for the ones that hand over a whole thread in
 * one answer, which would otherwise mount hundreds of cards at once.
 */
const REVEAL_STEP = 30;

/**
 * One comment thread: a series' or a chapter's (`chapterId`). The content only — whatever shows it
 * (the comments screen, the reader's sheet) owns the scrolling and calls `loadMore` near the end;
 * the button at the foot does the same by hand.
 *
 * Read-only. Where a composer would be, the foot links to the thread on the source's own site.
 */
export function CommentThread({
  bridgeId,
  seriesId,
  chapterId,
  countHint,
  ref,
}: {
  bridgeId: string;
  seriesId: string;
  chapterId?: string;
  /** The count the series or chapter list came with, shown until the thread's own arrives. */
  countHint?: number;
  ref?: Ref<CommentThreadHandle>;
}) {
  const theme = useTheme();
  const ds = useDataSource();
  const mock = useMockActive();
  const { byId, nameOf } = useBridgeMap();
  const info = byId.get(bridgeId)?.comments;
  const [sort, setSort] = useThreadSort(bridgeId, info?.sorts);
  const [now] = useState(() => Date.now());

  const query = useInfiniteQuery(
    commentsQuery(ds, mock, bridgeId, seriesId, { ...(chapterId && { chapterId }), ...(sort && { sort }) }, !!info),
  );
  const comments = mergeCommentPages(query.data?.pages);
  const first = query.data?.pages[0];

  const [shownCount, setShownCount] = useState(REVEAL_STEP);
  // A new order is a new thread: start it from the top (React's reset-on-prop-change, see AGENTS.md).
  const [shownFor, setShownFor] = useState(sort);
  if (shownFor !== sort) {
    setShownFor(sort);
    setShownCount(REVEAL_STEP);
  }
  const shown = comments.slice(0, shownCount);
  const hasMore = shown.length < comments.length || query.hasNextPage;

  const loadMore = () => {
    if (shown.length < comments.length) {
      setShownCount((n) => n + REVEAL_STEP);
    } else if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
      setShownCount((n) => n + REVEAL_STEP);
      void query.fetchNextPage();
    }
  };
  useImperativeHandle(ref, () => ({ loadMore }));

  if (!info) return null;

  const ctx: ThreadContext = { bridgeId, seriesId, ...(chapterId && { chapterId }), info, now };
  const total = first?.total ?? countHint;
  const control = sortControlFor(info.sorts);
  const webUrl = first?.webUrl;

  return (
    <View style={styles.thread}>
      {(total !== undefined || control !== 'none') && (
        <View style={styles.head}>
          {total !== undefined && (
            <ThemedText testID="comments.count" type="small" themeColor="textSecondary">
              {formatCommentCount(total)} {total === 1 ? 'comment' : 'comments'}
            </ThemedText>
          )}
          {control === 'segments' && (
            <SourceTabs
              sources={info.sorts!.map((s) => ({ id: s.id, name: s.label }))}
              activeId={sort ?? ''}
              onSelect={setSort}
              testIDFor={(id) => testId('comments.sort', id)}
            />
          )}
          {control === 'menu' && <SortMenuButton sorts={info.sorts!} sort={sort} onSort={setSort} />}
        </View>
      )}

      {query.isLoading ? (
        <View testID="comments.loading" style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : query.isError && comments.length === 0 ? (
        <RetryBlock message={friendlyError(query.error, "These comments couldn't load right now. Try again.")} onRetry={() => void query.refetch()} error={query.error} />
      ) : comments.length === 0 ? (
        <View testID="comments.empty" style={styles.center}>
          <ThemedText themeColor="textSecondary">{first?.closed ? 'Comments are closed here.' : 'No comments yet'}</ThemedText>
        </View>
      ) : (
        <View style={styles.list}>
          {shown.map((c) => (
            <CommentCard key={c.id} comment={c} ctx={ctx} />
          ))}
        </View>
      )}

      {comments.length > 0 && hasMore && (
        <Pressable
          testID="comments.more"
          onPress={() => (query.isFetchNextPageError ? void query.fetchNextPage() : loadMore())}
          disabled={query.isFetchingNextPage}
          accessibilityRole="button"
          style={styles.more}>
          {query.isFetchingNextPage ? (
            <ActivityIndicator color={theme.textSecondary} />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {query.isFetchNextPageError ? "Couldn't load more. Try again" : 'Load more comments'}
            </ThemedText>
          )}
        </Pressable>
      )}

      {webUrl && !query.isLoading && (
        <Pressable
          testID="comments.open-site"
          onPress={() => void openBrowserAsync(webUrl)}
          accessibilityRole="link"
          style={[styles.site, { borderTopColor: theme.hairline }]}>
          <OpenExternalIcon color={theme.accent} size={14} />
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Open on {nameOf(bridgeId)}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

/** "Sort: Relevant ▾", for a source with more orders than a row of segments holds. */
function SortMenuButton({
  sorts,
  sort,
  onSort,
}: {
  sorts: readonly { id: string; label: string }[];
  sort: string | undefined;
  onSort: (sort: string) => void;
}) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const current = sorts.find((s) => s.id === sort) ?? sorts[0]!;
  return (
    <Pressable
      testID="comments.sort"
      ref={ref}
      onPress={() => openAt(() => <SortMenu sorts={sorts} sort={current.id} onSort={onSort} />, { popover: true })}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Sort: ${current.label}`}
      style={[styles.sortButton, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small">
        <ThemedText type="small" themeColor="textSecondary">
          Sort:{' '}
        </ThemedText>
        {current.label}
      </ThemedText>
      <CaretDownIcon color={theme.textSecondary} size={12} />
    </Pressable>
  );
}

// The overlay builds its content once, when it opens, so a pick closes it: the tick it opened
// with would otherwise outlive the choice (see `ChoiceMenuButton`).
function SortMenu({ sorts, sort, onSort }: { sorts: readonly { id: string; label: string }[]; sort: string; onSort: (sort: string) => void }) {
  const { closeTop } = useOverlay();
  return (
    <OptionMenu title="Sort comments">
      <OptionList>
        {sorts.map((s) => (
          <OptionRow
            key={s.id}
            testID={testId('comments.sort', s.id)}
            label={s.label}
            selected={s.id === sort}
            onPress={() => {
              onSort(s.id);
              closeTop();
            }}
          />
        ))}
      </OptionList>
    </OptionMenu>
  );
}

const styles = StyleSheet.create({
  thread: {
    gap: Spacing.four,
  },
  head: {
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.four,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.five,
  },
  more: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  site: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  sortButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 999,
  },
});
