/**
 * The rules the comment surfaces share, free of React and react-native so they can be tested
 * directly (comments.test.ts): where a bridge's threads are, and how a comment's count, date,
 * votes and text read.
 */
import type { BridgeComments, Comment, CommentNode, CommentVotes } from '@comical/contract';

import type { ApiCommentPage } from './api';

/** Which of a bridge's threads the app offers: none when comments are off, for everything or for
 *  this bridge. */
export type CommentScopes = { series: boolean; chapter: boolean };

const NO_SCOPES: CommentScopes = { series: false, chapter: false };

export function commentScopes(
  comments: BridgeComments | undefined,
  prefs: { enabled: boolean; bridgeHidden: boolean },
): CommentScopes {
  if (!comments || !prefs.enabled || prefs.bridgeHidden) return NO_SCOPES;
  return { series: comments.scopes.includes('series'), chapter: comments.scopes.includes('chapter') };
}

/** 999, 1.2K, 15K, 1.2M: a count short enough for a row or a button. */
export function formatCommentCount(n: number): string {
  if (n < 1000) return String(n);
  const [unit, size] = n < 1_000_000 ? (['K', 1000] as const) : (['M', 1_000_000] as const);
  const value = n / size;
  // One decimal under ten of a unit, and never "10.0K" or a rounded-up "1000K".
  const text = value < 9.95 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.min(999, Math.round(value)));
  return `${text}${unit}`;
}

/** "Comments", with the count when the source gave one. */
export function commentsLabel(count: number | undefined): string {
  return count === undefined ? 'Comments' : `Comments · ${formatCommentCount(count)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When a comment was written, short: "now", "5m", "16h", "3d" inside a week and the date after it
 * (with the year once it isn't this one). A source that only says "3 weeks ago" has that passed
 * through as it came.
 */
export function commentTime(c: Pick<Comment, 'createdAt' | 'createdLabel'>, now: number): string | undefined {
  if (c.createdAt === undefined) return c.createdLabel;
  const age = now - c.createdAt;
  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d`;
  const at = new Date(c.createdAt);
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** The whole date and time, for the long-press on the short one. */
export function commentFullDate(createdAt: number): string {
  return new Date(createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** How a thread's sort is offered: nothing for a source with one order, segments for up to three,
 *  a menu past that. */
export function sortControlFor(sorts: BridgeComments['sorts']): 'none' | 'segments' | 'menu' {
  if (!sorts || sorts.length < 2) return 'none';
  return sorts.length <= 3 ? 'segments' : 'menu';
}

/** What a comment's vote row shows, by how the source counts votes. `null` draws no row. */
export type VoteDisplay = { kind: 'up-down'; up: number; down: number } | { kind: 'up'; up: number } | { kind: 'score'; score: number };

export function voteDisplay(votes: CommentVotes | undefined, mode: BridgeComments['votes']): VoteDisplay | null {
  if (!votes) return null;
  // A bridge that sends counts without declaring how they read is drawn by what it sent.
  const kind = mode ?? (votes.up === undefined && votes.score !== undefined ? 'score' : votes.down !== undefined ? 'up-down' : 'up');
  if (kind === 'score') {
    const score = votes.score ?? (votes.up !== undefined ? votes.up - (votes.down ?? 0) : undefined);
    return score === undefined ? null : { kind, score };
  }
  const up = votes.up ?? votes.score;
  if (up === undefined) return null;
  return kind === 'up' ? { kind, up } : { kind, up, down: votes.down ?? 0 };
}

/** A comment's emoji counts: the ones the bridge's palette names and anyone has used. */
export function reactionChips(
  reactions: Comment['reactions'],
  palette: BridgeComments['reactions'],
): { id: string; emoji: string; count: number }[] {
  if (!reactions || !palette) return [];
  return reactions.flatMap((r) => {
    const emoji = palette.find((p) => p.id === r.id)?.emoji;
    return emoji && r.count > 0 ? [{ id: r.id, emoji, count: r.count }] : [];
  });
}

/** The pages of a thread as one list. A source's list can shift between two requests, so a comment
 *  that turns up twice is kept once, where it first stood. */
export function mergeCommentPages(pages: readonly ApiCommentPage[] | undefined): Comment[] {
  const seen = new Set<string>();
  const out: Comment[] = [];
  for (const page of pages ?? []) {
    for (const c of page.items) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/** A comment's words as plain text, for Copy: line breaks kept, a quote marked, an image named. */
export function commentPlainText(body: readonly CommentNode[]): string {
  const part = (n: CommentNode): string => {
    switch (n.type) {
      case 'text':
        return n.text;
      case 'link':
        return n.text === n.url ? n.url : `${n.text} (${n.url})`;
      case 'mention':
        return `@${n.name}`;
      case 'image':
        return n.alt ? `[${n.alt}]` : '[image]';
      case 'break':
        return '\n';
      case 'quote':
        return `> ${n.author ? `${n.author}: ` : ''}${n.children.map(part).join('')}\n`;
    }
  };
  return body.map(part).join('').trim();
}

/** Whether any of a comment's text is behind an inline spoiler. */
export function hasInlineSpoiler(body: readonly CommentNode[]): boolean {
  return body.some((n) => (n.type === 'text' ? n.spoiler === true : n.type === 'quote' && n.children.some((c) => c.type === 'text' && c.spoiler === true)));
}

/** A name's initials for the circle that stands in for a missing avatar. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s_.-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[1]![0]] : [...(words[0] ?? '?')].slice(0, 1);
  return letters.join('').toUpperCase();
}

const EXCERPT_CHARS = 80;

/** The start of a comment, for the line that says which one a reply answers. */
function excerptOf(body: readonly CommentNode[]): string {
  const text = commentPlainText(body).replace(/\s+/g, ' ');
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : text;
}

/**
 * A comment's embedded replies as the ONE level the thread draws under it. A reply to a reply
 * comes up beside its parent, carrying the line it answers (`replyTo`) so the indent it lost is
 * still readable. A reply whose own replies are only partly here keeps them: its card asks the
 * source for the rest, and bringing up the part that came would show those twice.
 */
export function flattenReplies(replies: readonly Comment[] | undefined): Comment[] {
  const out: Comment[] = [];
  const walk = (list: readonly Comment[], parent: Comment | undefined) => {
    for (const reply of list) {
      const answered = parent && !reply.replyTo ? { replyTo: { name: parent.author.name, excerpt: excerptOf(parent.body) } } : {};
      const own = reply.replies ?? [];
      if (own.length === 0 || (reply.replyCount ?? 0) > own.length) {
        out.push({ ...reply, ...answered });
        continue;
      }
      const { replies: _flattened, replyCount: _counted, ...rest } = reply;
      out.push({ ...rest, ...answered });
      walk(own, reply);
    }
  };
  walk(replies ?? [], undefined);
  return out;
}
