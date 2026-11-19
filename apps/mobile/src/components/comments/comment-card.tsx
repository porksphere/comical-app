import type { BridgeComments, Comment } from '@comical/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CommentBody } from '@/components/comments/comment-body';
import { LikeIcon, OpenExternalIcon, PinnedIcon, ReplyToIcon, VoteDownIcon, VoteUpIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { showToast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import {
  commentFullDate,
  commentTime,
  flattenReplies,
  formatCommentCount,
  initialsOf,
  mergeCommentPages,
  reactionChips,
  voteDisplay,
} from '@/data/comments';
import { commentsQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

/** What every card of one thread shares: which thread it is, how its bridge's comments read, and
 *  the moment the thread was drawn (so every "16h" on it is measured from one clock). */
export type ThreadContext = {
  bridgeId: string;
  seriesId: string;
  chapterId?: string;
  info: BridgeComments;
  now: number;
};

const AVATAR = 32;
/** How many of a comment's embedded replies show before "Show N more". */
const REPLIES_SHOWN = 3;

const ROLE_LABEL = { creator: 'Creator', staff: 'Staff', moderator: 'Mod' } as const;

/**
 * One comment: who, when, what, how it was voted on, and its replies under it. Read-only, so
 * nothing on the vote row is tappable.
 *
 * Replies are ONE level: a top-level comment's replies indent under it behind a thin rule, and a
 * reply's own replies sit beside it with the line they answer rather than indenting again.
 */
export function CommentCard({ comment, ctx, nested = false }: { comment: Comment; ctx: ThreadContext; nested?: boolean }) {
  const theme = useTheme();
  const avatar = useResolvedAsset(comment.author.avatar);
  const [spoilerOpen, setSpoilerOpen] = useState(false);
  const [inlineShown, setInlineShown] = useState(false);
  const { author } = comment;
  const time = commentTime(comment, ctx.now);
  const votes = voteDisplay(comment.votes, ctx.info.votes);
  const reactions = reactionChips(comment.reactions, ctx.info.reactions);
  const chips = [...(comment.labels ?? []), ...(comment.chapter ? [comment.chapter.name] : [])];
  const hidden = comment.spoiler === true && !spoilerOpen;
  const id = comment.id;

  return (
    <View testID={testId('comments.comment', id)} style={styles.card}>
      <View style={styles.row}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={[styles.avatar, { backgroundColor: theme.backgroundElement }]} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.avatar, styles.initials, { backgroundColor: theme.tileWash }]}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.initialsText}>
              {initialsOf(author.name)}
            </ThemedText>
          </View>
        )}
        <View style={styles.main}>
          <View style={styles.header}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
              {author.name}
            </ThemedText>
            {author.role && <Tag label={ROLE_LABEL[author.role]} accent />}
            {author.badges?.map((b, i) => <Tag key={i} label={b} />)}
            {time !== undefined && (
              <Text
                style={[styles.time, { color: theme.textSecondary }]}
                {...(comment.createdAt !== undefined && { onLongPress: () => showToast(commentFullDate(comment.createdAt!)) })}>
                {time}
                {comment.edited ? ' (edited)' : ''}
              </Text>
            )}
            {time === undefined && comment.edited && <Text style={[styles.time, { color: theme.textSecondary }]}>(edited)</Text>}
            {comment.url && (
              <Pressable
                testID={testId('comments.open', id)}
                onPress={() => void openBrowserAsync(comment.url!)}
                hitSlop={10}
                accessibilityRole="link"
                accessibilityLabel="Open this comment on the site"
                style={styles.open}>
                <OpenExternalIcon color={theme.textSecondary} size={14} />
              </Pressable>
            )}
          </View>

          {(comment.pinned || chips.length > 0) && (
            <View style={styles.chips}>
              {comment.pinned && <Tag label="Pinned" icon={<PinnedIcon color={theme.textSecondary} size={11} />} />}
              {chips.map((label, i) => (
                <Tag key={i} label={label} />
              ))}
            </View>
          )}

          {comment.replyTo && (
            <View style={styles.replyTo}>
              <ReplyToIcon color={theme.textSecondary} size={13} />
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.replyToText}>
                <Text style={styles.replyToName}>{comment.replyTo.name}</Text>
                {comment.replyTo.excerpt ? `: ${comment.replyTo.excerpt}` : ''}
              </ThemedText>
            </View>
          )}

          {hidden ? (
            <Pressable
              testID={testId('comments.spoiler', id)}
              onPress={() => setSpoilerOpen(true)}
              accessibilityRole="button"
              style={[styles.spoilerBar, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">
                Spoiler · tap to show
              </ThemedText>
            </Pressable>
          ) : (
            <CommentBody body={comment.body} commentId={id} spoilersShown={inlineShown} onShowSpoilers={() => setInlineShown(true)} />
          )}

          {(votes || reactions.length > 0) && (
            <View style={styles.votes} accessibilityRole="text">
              {votes?.kind === 'up-down' && (
                <>
                  <Count icon={<VoteUpIcon color={theme.textSecondary} size={16} />} value={votes.up} label="up" />
                  <Count icon={<VoteDownIcon color={theme.textSecondary} size={16} />} value={votes.down} label="down" />
                </>
              )}
              {votes?.kind === 'up' && <Count icon={<LikeIcon color={theme.textSecondary} size={14} />} value={votes.up} label="likes" />}
              {votes?.kind === 'score' && <Count icon={<VoteUpIcon color={theme.textSecondary} size={16} />} value={votes.score} label="points" />}
              {reactions.map((r) => (
                <ThemedText key={r.id} type="small" themeColor="textSecondary" style={styles.count}>
                  {r.emoji} {formatCommentCount(r.count)}
                </ThemedText>
              ))}
            </View>
          )}
        </View>
      </View>

      <Replies comment={comment} ctx={ctx} nested={nested} />
    </View>
  );
}

/** A count with its glyph. A score can be below zero; a tally can't. */
function Count({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  const text = value < 0 ? `−${formatCommentCount(-value)}` : formatCommentCount(value);
  return (
    <View style={styles.countRow} accessibilityLabel={`${value} ${label}`}>
      {icon}
      <ThemedText type="small" themeColor="textSecondary" style={styles.count}>
        {text}
      </ThemedText>
    </View>
  );
}

/** A small capsule beside a name or over a body: a role, a badge, the source's own label. */
function Tag({ label, accent, icon }: { label: string; accent?: boolean; icon?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: accent ? theme.chipFill : theme.chipBg }]}>
      {icon}
      <Text numberOfLines={1} style={[styles.tagText, { color: accent ? theme.chipText : theme.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A comment's replies. The ones that came with it show first (three, then the rest); past those
 * the source is asked, a page at a time, and its list replaces the embedded one, since it starts
 * from the same first reply.
 */
function Replies({ comment, ctx, nested }: { comment: Comment; ctx: ThreadContext; nested: boolean }) {
  const theme = useTheme();
  const ds = useDataSource();
  const mock = useMockActive();
  const embedded = flattenReplies(comment.replies);
  const [revealed, setRevealed] = useState(false);
  const [asked, setAsked] = useState(false);
  const query = useInfiniteQuery(
    commentsQuery(ds, mock, ctx.bridgeId, ctx.seriesId, { ...(ctx.chapterId && { chapterId: ctx.chapterId }), parentId: comment.id }, asked),
  );
  const fetched = query.data ? flattenReplies(mergeCommentPages(query.data.pages)) : undefined;
  const list = fetched ?? embedded;
  const shown = fetched || revealed ? list : list.slice(0, REPLIES_SHOWN);
  const total = Math.max(comment.replyCount ?? 0, list.length);
  if (total === 0) return null;

  const left = total - shown.length;
  const more = left > 0 || query.hasNextPage;
  const loading = query.isFetching;
  const onMore = () => {
    if (!fetched && shown.length < list.length) setRevealed(true);
    else if (!asked) setAsked(true);
    else if (query.isError && !query.data) void query.refetch();
    else void query.fetchNextPage();
  };
  const label = query.isError
    ? "Couldn't load replies. Try again"
    : shown.length === 0
      ? `View ${formatCommentCount(total)} ${total === 1 ? 'reply' : 'replies'}`
      : left > 0
        ? `Show ${formatCommentCount(left)} more ${left === 1 ? 'reply' : 'replies'}`
        : 'Show more replies';

  return (
    // A reply's own replies stay on its level: a second rule and indent would leave a phone no
    // room for the words.
    <View style={nested ? styles.repliesFlat : [styles.replies, { borderLeftColor: theme.hairline }]}>
      {shown.map((reply) => (
        <CommentCard
          key={reply.id}
          comment={nested && !reply.replyTo ? { ...reply, replyTo: { name: comment.author.name } } : reply}
          ctx={ctx}
          nested
        />
      ))}
      {more && (
        <Pressable
          testID={testId('comments.replies', comment.id)}
          onPress={onMore}
          disabled={loading}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.moreReplies}>
          {loading && <ActivityIndicator size="small" color={theme.textSecondary} />}
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {loading ? 'Loading replies…' : label}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
  },
  initials: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 12,
    lineHeight: 16,
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: Spacing.two,
    rowGap: 2,
    minHeight: 20,
  },
  name: {
    flexShrink: 1,
  },
  time: {
    fontSize: 13,
    lineHeight: 20,
  },
  open: {
    marginLeft: 'auto',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: 600,
  },
  replyTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  replyToText: {
    flex: 1,
    fontSize: 13,
  },
  replyToName: {
    fontWeight: 700,
  },
  spoilerBar: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 8,
  },
  votes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Spacing.three,
    rowGap: Spacing.one,
    marginTop: 2,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  count: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  replies: {
    marginLeft: AVATAR / 2,
    paddingLeft: AVATAR / 2 + Spacing.two - 1,
    borderLeftWidth: 1,
    gap: Spacing.three,
  },
  repliesFlat: {
    gap: Spacing.three,
  },
  moreReplies: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 28,
  },
});
