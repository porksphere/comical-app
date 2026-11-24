/**
 * The mock catalog's series: real works under their own titles, credits and chapter lists.
 *
 * Every cover in `assets/mock/` is a real comic's, so the card under it says what it is — the
 * episode of Pepper&Carrot it was painted for, the issue of the comic book it fronted. Two of the
 * licences ask for exactly that (Black Jack's terms want its title and author shown with the work,
 * unaltered; Pepper&Carrot's its attribution), and a real picture under an invented name is a
 * mislabel either way. `assets/mock/README.md` has each work's licence and source.
 *
 * What stays invented is what the app does WITH them: who is reading what, what is unread, which
 * chapter arrived an hour ago. And most of the pages: the fixtures hold a handful per work, so a
 * chapter they don't hold is read from that handful, at the chapter's real length.
 */
import { MOCK_COVERS, MOCK_COVERS_VARIED, MOCK_MANGA_PAGES, MOCK_PAGES, mockWorkCover } from './mock-assets';
import type { MetaCell, SeriesEntry } from './types';

export type WorkChapter = {
  name: string;
  number: number;
  pages: number;
  /** The chapter's own pages, where the fixtures hold them; else it is read from the work's. */
  art?: string[];
};

export type Work = Pick<SeriesEntry, 'coverForm' | 'readingDirection'> & {
  /** What a series id ends in to say which work it is (see `workOf`). */
  id: string;
  title: string;
  cover: string;
  meta: MetaCell[];
  altTitles?: string[];
  description: string;
  /** From the mock genre filter's own options, so a tapped chip drives that filter. */
  genres: string[];
  tagGroups?: { label: string; tags: string[] }[];
  /** First to last. */
  chapters: WorkChapter[];
  /** The pages the fixtures hold of it, which each chapter is read from. */
  art: string[];
};

/** Pepper&Carrot's episodes as published, with each one's page count (the title and credits
 *  pages aside): https://www.peppercarrot.com/en/webcomic/index.html */
const EPISODES: [title: string, pages: number][] = [
  ['The Potion of Flight', 3], ['Rainbow Potions', 5], ['The Secret Ingredients', 7],
  ['Stroke of Genius', 7], ['Special holiday episode', 4], ['The Potion Contest', 9],
  ['The Wish', 5], ["Pepper's Birthday Party", 6], ['The Remedy', 7], ['Summer Special', 5],
  ['The Witches of Chaosah', 6], ['Autumn Clearout', 7], ['The Pyjama Party', 6],
  ["The Dragon's Tooth", 6], ['The Crystal Ball', 8], ['The Sage of the Mountain', 6],
  ['A Fresh Start', 7], ['The Encounter', 7], ['Pollution', 7], ['The Picnic', 6],
  ['The Magic Contest', 7], ['The Voting System', 10], ['Take a Chance', 7], ['The Unity Tree', 7],
  ['There Are No Shortcuts', 9], ['Books Are Great', 6], ["Coriander's Invention", 6],
  ['The Festivities', 9], ['Destroyer of Worlds', 8], ['Need a Hug', 6], ['The Fight', 7],
  ['The Battlefield', 7], ['Spell of War', 8], ['The Knighting of Shichimi', 10],
  ['The Reflection', 12], ['The Surprise Attack', 15], ['The Tears of the Phoenix', 8],
  ['The Healer', 8], ['The Tavern', 11],
];

/** The episodes the fixtures hold the pages of, in reading order (`PAGES` in
 *  `scripts/build-mock-art.py`): the first whole, the second its first four. */
const EPISODE_ART: Record<number, string[]> = {
  1: [MOCK_PAGES[5]!, MOCK_PAGES[6]!, MOCK_PAGES[4]!],
  2: MOCK_PAGES.slice(0, 4),
};

const episodeChapter = (n: number): WorkChapter => ({
  name: `Episode ${n}: ${EPISODES[n - 1]![0]}`,
  number: n,
  pages: EPISODES[n - 1]![1],
  ...(EPISODE_ART[n] && { art: EPISODE_ART[n] }),
});

const REVOY: MetaCell = { label: 'AUTHOR', value: 'David Revoy', credits: [{ name: 'David Revoy' }] };

/** One episode as a series of its own, the way a library lists a comic it holds as files: its
 *  cover is the episode's cover, and its one chapter is the episode. It declares no form or
 *  direction, so it is drawn and read as its bridge's series are. */
const episode = (n: number, cover: string): Work => ({
  id: `pepper-and-carrot-${n}`,
  title: EPISODES[n - 1]![0],
  cover,
  meta: [{ label: 'STATUS', value: 'Completed' }, { label: 'TYPE', value: 'Webcomic' }, REVOY],
  altTitles: [`Pepper&Carrot, episode ${n}`],
  genres: ['Fantasy', 'Adventure'],
  tagGroups: [{ label: 'Themes', tags: ['Magic'] }],
  description:
    `Episode ${n} of Pepper&Carrot, the webcomic about a young witch and her cat in the world of ` +
    'Hereva. By David Revoy, licensed CC BY 4.0.',
  chapters: [episodeChapter(n)],
  art: MOCK_PAGES,
});

// The episode each cover file was cut from, in file order. `scripts/build-mock-art.py` holds the
// same two lists (`COVERS`, `COVERS_VARIED`): keep them in step.
const COVER_EPISODES = [3, 6, 7, 5, 24, 33, 11, 19, 17, 22, 26, 38, 16, 31, 20, 23, 13, 30, 14, 37, 1, 25, 2, 29];
const VARIED_COVER_EPISODES = [32, 18, 9, 34, 39, 4, 8, 12, 15, 21, 27, 28, 35, 36];

/** In cover-file order, so episode `k` here is of palette family `k % 6` (see `walkCovers`). */
export const EPISODE_WORKS: Work[] = COVER_EPISODES.map((n, k) => episode(n, MOCK_COVERS[k]!));

/** The episodes whose covers AREN'T a uniform 2:3, for the one bridge that serves those. */
export const VARIED_WORKS: Work[] = VARIED_COVER_EPISODES.map((n, k) => episode(n, MOCK_COVERS_VARIED[k]!));

const comicBook = (id: string, title: string, issue: number, artists: string[], description: string): Work => ({
  id,
  title,
  cover: mockWorkCover(id),
  coverForm: 'issue',
  readingDirection: 'ltr',
  meta: [
    { label: 'STATUS', value: 'Completed' },
    { label: 'TYPE', value: 'Comic book' },
    { label: 'ARTIST', value: artists.join(', '), credits: artists.map((name) => ({ name })) },
  ],
  description,
  genres: ['Action', 'Adventure'],
  // The issue the cover is of, and the cover is the page of it the fixtures hold.
  chapters: [{ name: `Issue ${issue}`, number: issue, pages: 1 }],
  art: [mockWorkCover(id)],
});

/** The works that run to more than one chapter, or front a real printed cover. */
export const NAMED_WORKS: Work[] = [
  {
    id: 'pepper-and-carrot',
    title: 'Pepper&Carrot',
    cover: mockWorkCover('pepper-and-carrot'),
    coverForm: 'volume',
    readingDirection: 'ltr',
    meta: [{ label: 'STATUS', value: 'Ongoing' }, { label: 'TYPE', value: 'Webcomic' }, REVOY],
    description:
      'Pepper is a young witch and Carrot is her cat. They live in the world of Hereva, where a ' +
      'potion rarely does what it was brewed for. Pepper&Carrot by David Revoy, licensed CC BY 4.0.',
    genres: ['Fantasy', 'Adventure'],
    tagGroups: [{ label: 'Themes', tags: ['Magic'] }],
    chapters: EPISODES.map((_, i) => episodeChapter(i + 1)),
    art: MOCK_PAGES,
  },
  {
    id: 'black-jack',
    title: 'Give My Regards to Black Jack',
    cover: mockWorkCover('black-jack'),
    coverForm: 'volume',
    readingDirection: 'rtl',
    meta: [
      { label: 'STATUS', value: 'Completed' },
      { label: 'TYPE', value: 'Manga' },
      { label: 'AUTHOR', value: 'SHUHO SATO', credits: [{ name: 'SHUHO SATO' }] },
    ],
    altTitles: ['ブラックジャックによろしく'],
    description:
      'Eijiro Saito is an intern at a university hospital, three months out of medical school, ' +
      'working sixteen hours a day for a salary nobody could live on. To make rent he takes the ' +
      'night shift at another hospital, where the patients do not wait for him to be ready. ' +
      "Give My Regards to Black Jack by SHUHO SATO, shown here under the author's free-use terms.",
    genres: ['Drama'],
    tagGroups: [{ label: 'Demographic', tags: ['Seinen'] }],
    // Volume 1, as its contents page lists it.
    chapters: [
      'Night of the Intern',
      'Eels and Godhands',
      'The Price of Being 75',
      'Summer Clouds',
      'Surgery, Internists, Departments, And Saito',
      'The First Lie',
      'The Top-tier Trap',
    ].map((name, i) => ({ name: `Ep.${String(i + 1).padStart(2, '0')} ${name}`, number: i + 1, pages: MOCK_MANGA_PAGES.length })),
    art: MOCK_MANGA_PAGES,
  },
  comicBook(
    'planet-comics',
    'Planet Comics',
    1,
    ['Lou Fine'],
    "Fiction House's science-fiction anthology. This is the first issue, January 1940, with a " +
      'cover by Lou Fine. In the public domain in the United States.',
  ),
  comicBook(
    'wonderworld-comics',
    'Wonderworld Comics',
    3,
    ['Will Eisner', 'Lou Fine'],
    "Fox Feature Syndicate's anthology, and the home of the Flame. This is issue 3, July 1939, " +
      'with a cover by Will Eisner and Lou Fine. In the public domain in the United States.',
  ),
  comicBook(
    'fantastic-comics',
    'Fantastic Comics',
    3,
    ['Lou Fine'],
    "Fox Feature Syndicate's anthology, led by Samson. This is issue 3, February 1940, with a " +
      'cover by Lou Fine. In the public domain in the United States.',
  ),
];

export const WORKS: Work[] = [...NAMED_WORKS, ...EPISODE_WORKS, ...VARIED_WORKS];

const BY_ID = new Map(WORKS.map((w) => [w.id, w]));
const BY_TITLE = new Map(WORKS.map((w) => [w.title, w]));

export const work = (id: string): Work => {
  const w = BY_ID.get(id);
  if (!w) throw new Error(`no mock work "${id}"`);
  return w;
};

export const workTitled = (title: string): Work | undefined => BY_TITLE.get(title);

const MARK = /-work-([a-z0-9-]+)$/;

/** A series id that says which work it is. The id is the one thing every lookup has (the detail,
 *  the chapter list, the pages), so that is where a card's work is kept. */
export const markedId = (seriesId: string, w: Work): string => `${seriesId}-work-${w.id}`;

/** The work a series id was marked with, if it was. */
export const markedWork = (seriesId: string): Work | undefined => {
  const id = MARK.exec(seriesId)?.[1];
  return id === undefined ? undefined : BY_ID.get(id);
};

/** A chapter's pages: as many as the chapter has, dealt from what the fixtures hold of the work. */
export const chapterPages = (w: Work, chapter: WorkChapter): string[] => {
  const art = chapter.art ?? w.art;
  return Array.from({ length: chapter.pages }, (_, i) => art[i % art.length]!);
};
