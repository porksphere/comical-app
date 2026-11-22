/**
 * Comment threads for the mock bridges: deterministic, and between them every shape the thread UI
 * draws — each sort control, each vote style, lazy and embedded replies, a flattened deep reply,
 * spoilers, images, quotes, a label-only date, an empty thread.
 */
import type { BridgeComments, Comment, CommentNode, CommentPage } from '@comical/contract';

import type { CommentsQuery } from './api';
import { MOCK_COVERS } from './mock-assets';

/** What each mock bridge declares, keyed by bridge id. A bridge left out has no comments. */
export const MOCK_BRIDGE_COMMENTS: Record<string, BridgeComments> = {
  panelfox: {
    scopes: ['series', 'chapter'],
    sorts: [
      { id: 'best', label: 'Best' },
      { id: 'new', label: 'Newest' },
      { id: 'old', label: 'Oldest' },
    ],
    votes: 'up-down',
    maxDepth: 2,
  },
  inkwell: {
    scopes: ['chapter'],
    sorts: [
      { id: 'relevant', label: 'Relevant' },
      { id: 'new', label: 'Newest' },
      { id: 'old', label: 'Oldest' },
      { id: 'liked', label: 'Most liked' },
      { id: 'replies', label: 'Most replies' },
    ],
    votes: 'up',
    reactions: [
      { id: 'heart', emoji: '❤️' },
      { id: 'laugh', emoji: '😂' },
      { id: 'cry', emoji: '😭' },
    ],
    maxDepth: 2,
  },
  driftpage: { scopes: ['series'], votes: 'score', maxDepth: 1 },
  coldspine: { scopes: ['series'], maxDepth: 1 },
};

const PAGE_SIZE = 10;
const HOUR = 3_600_000;

const NAMES = ['mossgiant', 'Aoi_reads', 'paperlantern', 'Quill', 'north_gate', 'tidewater', 'Sable', 'onigiri44', 'Wren', 'halfmoon'];
const LINES = [
  'That last panel is going to live in my head all week.',
  'The pacing in this arc is so much better than the last one.',
  'I did not expect the gardener to matter this much.',
  'Reread the whole thing after this. Everything was set up from the start.',
  'The art keeps getting better. Look at the backgrounds in the market scene.',
  'Calling it now: the letter was never sent.',
  'Thanks for the chapter!',
  'This is the one I look forward to every week.',
];
const LONG =
  'I think people are reading the ending wrong. The bell rings twice in the first chapter and twice here, and both times the lamp is already out. ' +
  'That is not a coincidence, and it changes what the promise at the bridge meant. If the lamp was out, nobody was waiting, which means the whole middle arc ' +
  'is told by someone who could not have seen it. Go back and look at who is standing in the doorway in the flashback. It is drawn from the same angle as the cover. ' +
  'I am not saying the narrator lied, only that they were told the story later, and the gaps are where it hurts most.';

// Mixed at the end: neighbouring comments differ in their last character alone, and unmixed
// their votes and names would come out in step.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const text = (t: string): CommentNode => ({ type: 'text', text: t });

function bodyOf(i: number, h: number): CommentNode[] {
  switch (i % 9) {
    case 2:
      return [text('I knew it. '), { type: 'text', text: 'The captain was the one who opened the gate.', spoiler: true }, text(' Called it in chapter 3.')];
    case 3:
      return [text(LONG)];
    case 4:
      return [{ type: 'quote', author: NAMES[(h + 3) % NAMES.length]!, children: [{ type: 'text', text: 'Is this the last arc?' }] }, text('The author said two more volumes.')];
    case 5:
      return [text('Me after this chapter:'), { type: 'break' }, { type: 'image', url: MOCK_COVERS[(h + i) % MOCK_COVERS.length]!, width: 300, height: 420, alt: 'reaction' }];
    case 6:
      return [
        { type: 'mention', name: NAMES[(h + 1) % NAMES.length]! },
        text(' the '),
        { type: 'text', text: 'official', bold: true },
        text(' translation is '),
        { type: 'link', text: 'on the publisher’s site', url: 'https://example.com/read' },
        text('.'),
      ];
    default:
      return [text(LINES[(h + i) % LINES.length]!)];
  }
}

function replyOf(parent: string, j: number, h: number, now: number): Comment {
  const flattened = j === 2;
  return {
    id: `${parent}:r${j}`,
    parentId: parent,
    author: { name: NAMES[(h + j + 4) % NAMES.length]! },
    body: [text(j === 0 ? 'Same. I had to put my phone down.' : LINES[(h + j + 2) % LINES.length]!)],
    createdAt: now - (j + 1) * 20 * 60_000,
    // A reply to a reply, brought up to the second level with the line it answers.
    ...(flattened && { replyTo: { name: NAMES[(h + 4) % NAMES.length]!, excerpt: 'Same. I had to put my phone down.' } }),
    votes: { up: 3 + j, down: 0, score: 3 + j },
  };
}

function commentOf(thread: string, i: number, total: number, seriesThread: boolean, now: number): Comment {
  const h = hash(`${thread}:${i}`);
  const id = `${thread}:c${i}`;
  const replies = i % 4 === 1 ? 3 : i % 7 === 0 && i > 0 ? 14 : 0;
  const up = 4 + ((h >>> 3) % 240);
  const down = (h >>> 5) % 9;
  return {
    id,
    url: `https://example.com/comments/${encodeURIComponent(id)}`,
    author: {
      name: NAMES[h % NAMES.length]!,
      ...(i % 3 === 0 && { avatar: MOCK_COVERS[h % MOCK_COVERS.length]! }),
      ...(i === 0 && { role: 'staff' as const }),
      ...(i === 6 && { role: 'creator' as const }),
      ...(i === 8 && { badges: ['Supporter'] }),
    },
    body: bodyOf(i, h),
    // One comment a thread dates itself the way a source with only "3 weeks ago" would.
    ...(i === 7 ? { createdLabel: '3 weeks ago' } : { createdAt: now - (i + 1) * 5 * HOUR - (h % HOUR) }),
    ...(i % 5 === 3 && { edited: true }),
    ...(i === 0 && { pinned: true }),
    ...(i === 1 && { labels: ['Top'] }),
    ...(i === 9 && { spoiler: true }),
    ...(seriesThread && i % 6 === 4 && { chapter: { id: `ch-${12 + (h % 30)}`, name: `Chapter ${12 + (h % 30)}` } }),
    votes: { up, down, score: up - down },
    ...(i % 4 === 0 && { reactions: [{ id: 'heart', count: 2 + (h % 30) }, { id: 'laugh', count: h % 6 }] }),
    ...(replies > 0 && { replyCount: replies }),
    // The short threads arrive with their replies; the long one is asked for.
    ...(replies === 3 && { replies: [0, 1, 2].map((j) => replyOf(id, j, h, now)) }),
    ...(total - i === 1 && { body: [text('First!')] }),
  };
}

/** How many comments a thread holds: none for a "bare" series, a few for a chapter, pages for a series. */
function threadSize(seriesId: string, chapterId: string | undefined): number {
  if (seriesId.includes('bare')) return 0;
  const h = hash(`${seriesId}:${chapterId ?? ''}`);
  return chapterId ? 4 + (h % 14) : 34 + (h % 40);
}

/** The count a source would send with the series or the chapter list. */
export function mockCommentCount(seriesId: string, chapterId?: string): number {
  return threadSize(seriesId, chapterId);
}

/** One page of a mock thread, or of one comment's replies. The cursor is the offset to resume at. */
export function mockCommentPage(bridgeId: string, seriesId: string, query: CommentsQuery, cursor?: string): CommentPage {
  const now = Date.now();
  const thread = `${bridgeId}:${seriesId}:${query.chapterId ?? ''}`;
  const from = Number(cursor ?? 0) || 0;
  const webUrl = `https://example.com/series/${encodeURIComponent(seriesId)}${query.chapterId ? `/${encodeURIComponent(query.chapterId)}` : ''}#comments`;

  if (query.parentId) {
    const h = hash(query.parentId);
    const all = Array.from({ length: 14 }, (_, j) => replyOf(query.parentId!, j, h, now));
    const items = all.slice(from, from + PAGE_SIZE);
    return { items, ...(from + PAGE_SIZE < all.length && { nextCursor: String(from + PAGE_SIZE) }), webUrl };
  }

  const total = threadSize(seriesId, query.chapterId);
  let order = Array.from({ length: total }, (_, i) => i);
  if (query.sort === 'old') order = order.reverse();
  else if (query.sort && query.sort !== 'new') order = [...order].sort((a, b) => (hash(`${thread}:${b}`) % 97) - (hash(`${thread}:${a}`) % 97));
  const items = order.slice(from, from + PAGE_SIZE).map((i) => commentOf(thread, i, total, !query.chapterId, now));
  return { items, ...(from + PAGE_SIZE < total && { nextCursor: String(from + PAGE_SIZE) }), total, webUrl };
}
