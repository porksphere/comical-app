import { describe, expect, test } from 'bun:test';

import type { Comment } from '@comical/contract';

import type { ApiCommentPage } from '@/data/api';
import {
  commentPlainText,
  commentScopes,
  commentTime,
  commentsLabel,
  flattenReplies,
  formatCommentCount,
  hasInlineSpoiler,
  initialsOf,
  mergeCommentPages,
  reactionChips,
  sortControlFor,
  voteDisplay,
} from '@/data/comments';
import { mockCommentCount, mockCommentPage } from '@/data/mock-comments';

const on = { enabled: true, bridgeHidden: false };

describe('commentScopes', () => {
  test('a bridge without comments offers nothing', () => {
    expect(commentScopes(undefined, on)).toEqual({ series: false, chapter: false });
  });

  test('only the scopes the bridge declared', () => {
    expect(commentScopes({ scopes: ['chapter'] }, on)).toEqual({ series: false, chapter: true });
    expect(commentScopes({ scopes: ['series', 'chapter'] }, on)).toEqual({ series: true, chapter: true });
  });

  test('either switch turns every scope off', () => {
    const both = { scopes: ['series', 'chapter'] as ('series' | 'chapter')[] };
    expect(commentScopes(both, { enabled: false, bridgeHidden: false })).toEqual({ series: false, chapter: false });
    expect(commentScopes(both, { enabled: true, bridgeHidden: true })).toEqual({ series: false, chapter: false });
  });
});

describe('formatCommentCount', () => {
  test('small counts are exact', () => {
    expect(formatCommentCount(0)).toBe('0');
    expect(formatCommentCount(999)).toBe('999');
  });

  test('thousands and millions are abbreviated', () => {
    expect(formatCommentCount(1000)).toBe('1K');
    expect(formatCommentCount(1234)).toBe('1.2K');
    expect(formatCommentCount(9949)).toBe('9.9K');
    expect(formatCommentCount(9950)).toBe('10K');
    expect(formatCommentCount(15_432)).toBe('15K');
    expect(formatCommentCount(999_999)).toBe('999K');
    expect(formatCommentCount(1_200_000)).toBe('1.2M');
  });

  test('the label goes without a count the source never gave', () => {
    expect(commentsLabel(undefined)).toBe('Comments');
    expect(commentsLabel(787)).toBe('Comments · 787');
  });
});

describe('commentTime', () => {
  const now = new Date(2026, 5, 15, 12).getTime();
  const ago = (ms: number) => commentTime({ createdAt: now - ms }, now);

  test('relative inside a week', () => {
    expect(ago(20_000)).toBe('now');
    expect(ago(5 * 60_000)).toBe('5m');
    expect(ago(16 * 3_600_000)).toBe('16h');
    expect(ago(3 * 86_400_000)).toBe('3d');
  });

  test('a date after that, with the year once it is another one', () => {
    expect(ago(8 * 86_400_000)).not.toMatch(/\d{4}/);
    expect(ago(400 * 86_400_000)).toMatch(/2025/);
  });

  test("a source's own label stands in for a missing time, and nothing for neither", () => {
    expect(commentTime({ createdLabel: '3 weeks ago' }, now)).toBe('3 weeks ago');
    expect(commentTime({}, now)).toBeUndefined();
  });
});

describe('sortControlFor', () => {
  const sorts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `S${i}` }));

  test('no control for no choice', () => {
    expect(sortControlFor(undefined)).toBe('none');
    expect(sortControlFor(sorts(1))).toBe('none');
  });

  test('segments up to three, a menu past that', () => {
    expect(sortControlFor(sorts(2))).toBe('segments');
    expect(sortControlFor(sorts(3))).toBe('segments');
    expect(sortControlFor(sorts(4))).toBe('menu');
  });
});

describe('voteDisplay', () => {
  test('follows how the bridge says votes read', () => {
    expect(voteDisplay({ up: 12, down: 3 }, 'up-down')).toEqual({ kind: 'up-down', up: 12, down: 3 });
    expect(voteDisplay({ up: 12, down: 3 }, 'up')).toEqual({ kind: 'up', up: 12 });
    expect(voteDisplay({ up: 12, down: 3 }, 'score')).toEqual({ kind: 'score', score: 9 });
    expect(voteDisplay({ score: -4 }, 'score')).toEqual({ kind: 'score', score: -4 });
  });

  test('an undeclared style is read off what was sent', () => {
    expect(voteDisplay({ score: 7 }, undefined)).toEqual({ kind: 'score', score: 7 });
    expect(voteDisplay({ up: 7 }, undefined)).toEqual({ kind: 'up', up: 7 });
    expect(voteDisplay({ up: 7, down: 0 }, undefined)).toEqual({ kind: 'up-down', up: 7, down: 0 });
  });

  test('nothing to show draws no row', () => {
    expect(voteDisplay(undefined, 'up-down')).toBeNull();
    expect(voteDisplay({}, 'up')).toBeNull();
    expect(voteDisplay({ mine: 'up' }, 'score')).toBeNull();
  });
});

describe('reactionChips', () => {
  const palette = [
    { id: 'heart', emoji: '❤️' },
    { id: 'laugh', emoji: '😂' },
  ];

  test('used reactions the palette names, in the order they came', () => {
    expect(reactionChips([{ id: 'laugh', count: 2 }, { id: 'heart', count: 9 }], palette)).toEqual([
      { id: 'laugh', emoji: '😂', count: 2 },
      { id: 'heart', emoji: '❤️', count: 9 },
    ]);
  });

  test('an unused one, an unknown one and a bridge with no palette are all left out', () => {
    expect(reactionChips([{ id: 'heart', count: 0 }, { id: 'nope', count: 4 }], palette)).toEqual([]);
    expect(reactionChips([{ id: 'heart', count: 3 }], undefined)).toEqual([]);
    expect(reactionChips(undefined, palette)).toEqual([]);
  });
});

describe('mergeCommentPages', () => {
  const page = (...ids: string[]): ApiCommentPage => ({ items: ids.map((id) => ({ id, author: { name: 'a' }, body: [] })) });

  test('pages in order, a repeat kept where it first stood', () => {
    expect(mergeCommentPages([page('a', 'b'), page('b', 'c')]).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  test('nothing loaded is an empty thread', () => {
    expect(mergeCommentPages(undefined)).toEqual([]);
  });
});

describe('comment text', () => {
  test('plain text keeps breaks, marks a quote and names what is not text', () => {
    expect(
      commentPlainText([
        { type: 'quote', author: 'Wren', children: [{ type: 'text', text: 'Is it over?' }] },
        { type: 'mention', name: 'Wren' },
        { type: 'text', text: ' no, see ' },
        { type: 'link', text: 'this', url: 'https://example.com/a' },
        { type: 'break' },
        { type: 'image', url: 'https://example.com/a.gif' },
      ]),
    ).toBe('> Wren: Is it over?\n@Wren no, see this (https://example.com/a)\n[image]');
  });

  test('a bare link is not written twice', () => {
    expect(commentPlainText([{ type: 'link', text: 'https://example.com', url: 'https://example.com' }])).toBe('https://example.com');
  });

  test('an inline spoiler is found in the body or inside a quote', () => {
    expect(hasInlineSpoiler([{ type: 'text', text: 'a' }])).toBe(false);
    expect(hasInlineSpoiler([{ type: 'text', text: 'a', spoiler: true }])).toBe(true);
    expect(hasInlineSpoiler([{ type: 'quote', children: [{ type: 'text', text: 'a', spoiler: true }] }])).toBe(true);
  });

  test('initials', () => {
    expect(initialsOf('mossgiant')).toBe('M');
    expect(initialsOf('north_gate')).toBe('NG');
    expect(initialsOf('Aoi reads a lot')).toBe('AR');
    expect(initialsOf('  ')).toBe('?');
  });
});

describe('flattenReplies', () => {
  const c = (id: string, over: Partial<Comment> = {}): Comment => ({ id, author: { name: `user-${id}` }, body: [{ type: 'text', text: `body of ${id}` }], ...over });

  test('a reply to a reply comes up one level, saying what it answers', () => {
    const flat = flattenReplies([c('a', { replies: [c('a1', { replies: [c('a1x')] })] }), c('b')]);
    expect(flat.map((r) => r.id)).toEqual(['a', 'a1', 'a1x', 'b']);
    expect(flat[0]!.replyTo).toBeUndefined();
    expect(flat[1]!.replyTo).toEqual({ name: 'user-a', excerpt: 'body of a' });
    expect(flat[2]!.replyTo).toEqual({ name: 'user-a1', excerpt: 'body of a1' });
    expect(flat.every((r) => r.replies === undefined)).toBe(true);
  });

  test("the source's own replyTo is kept", () => {
    const flat = flattenReplies([c('a', { replies: [c('a1', { replyTo: { name: 'someone' } })] })]);
    expect(flat[1]!.replyTo).toEqual({ name: 'someone' });
  });

  test('a reply with more replies than came keeps them for its own card to finish', () => {
    const flat = flattenReplies([c('a', { replyCount: 9, replies: [c('a1')] })]);
    expect(flat.map((r) => r.id)).toEqual(['a']);
    expect(flat[0]!.replies?.map((r) => r.id)).toEqual(['a1']);
    expect(flat[0]!.replyCount).toBe(9);
  });

  test('a long parent is quoted by its start', () => {
    const long = c('a', { body: [{ type: 'text', text: 'x'.repeat(300) }], replies: [c('a1')] });
    expect(flattenReplies([long])[1]!.replyTo!.excerpt!.length).toBe(80);
  });

  test('no replies is an empty list', () => {
    expect(flattenReplies(undefined)).toEqual([]);
  });
});

describe('mock threads', () => {
  test('a thread pages to its end without repeating a comment', () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = mockCommentPage('panelfox', 'series-1', {}, cursor);
      ids.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids.length).toBe(mockCommentCount('series-1'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('each sort is the same comments in another order', () => {
    const first = (sort: string) => mockCommentPage('panelfox', 'series-1', { sort }).items.map((c) => c.id);
    expect(first('new')).not.toEqual(first('old'));
    expect(mockCommentPage('panelfox', 'series-1', { sort: 'old' }).total).toBe(mockCommentCount('series-1'));
  });

  test('replies come by their parent, and a bare series has an empty thread', () => {
    const replies = mockCommentPage('panelfox', 'series-1', { parentId: 'x:c7' });
    expect(replies.items.every((c) => c.parentId === 'x:c7')).toBe(true);
    expect(replies.nextCursor).toBeDefined();
    expect(mockCommentPage('panelfox', 'bare-1', {}).items).toEqual([]);
  });
});
