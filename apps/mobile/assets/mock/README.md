# Mock catalog art

Only reachable from mock mode (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1` or the `__DEV__` Settings
toggle) — see `src/data/source.ts`. Wired up in `src/data/mock-assets.ts`.

These replaced live `picsum.photos` requests, which made the "comics" stock photographs of
skyscrapers and laptops — a different picture on every load, and a third-party service deciding
whether a grid rendered at all. Serving our own committed bytes keeps the network dependency but
makes the content deterministic, which was the half that mattered.

They are served, not bundled: `mock-assets.ts` builds jsDelivr URLs pointing at this directory, so
nothing here reaches an app bundle. The ref follows `main`, and CI passes the commit under test, so
adding or redrawing art needs no other edit — a branch's own art shows up in its own screenshots
and e2e runs, and everything else picks it up on merge. Local dev is the one place that sees
`main`'s set rather than the branch's.

Bundling was tried first and reverted. A bundled page resolves to a resource path in a release
build, and the download engine's `PageFetcher` (`src/data/downloads/fetch-page.ts`) resolves a
page to a `data:` URI or an http(s) URL — a resource path is neither, so downloading a mock
chapter had no working path. URLs are the shape every real source already hands it.

The cost is that mock mode is online-only.

Every picture here is a real comic's, and the mock catalog names each for what it is
(`src/data/mock-works.ts`): the series a cover fronts carries that work's title, credit and
chapter list. Two of the licences below ask for that, and a real picture under an invented name is
a mislabel under any of them. The one invented series, the long-title fixture, has a drawn cover
and drawn pages (`fixture/`, `fixture-pages/`) for the same reason.

`scripts/build-mock-art.py` builds everything but the drawn files from the sources below, and
`scripts/generate-mock-shapes.py` draws those. Both outputs are committed.

## Pepper&Carrot, David Revoy — `covers/`, `covers-varied/`, `pages/`, `works/pepper-and-carrot.jpg`

**CC BY 4.0.** Attribution is a licence condition here, not a courtesy:

> *Pepper&Carrot* by David Revoy — https://www.peppercarrot.com — licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Cropped, downscaled and recompressed
> for use as fixtures; not otherwise altered.

- `covers/` — 24 episode covers, from each episode's textless art
  (`0_sources/<episode>/hi-res/gfx-only/`), cut to a 2:3 window. Each is the cover of that episode
  as a series of its own, under the episode's title.
- `covers-varied/` — 14 more, cut to other shapes, for the one mock bridge whose covers are not a
  uniform 2:3. Between the two sets every episode but the tenth is here once.
- `works/pepper-and-carrot.jpg` — the cover painted for the third printed book
  ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:2018-11-22_vertical-cover-book-three_by-David-Revoy.jpg)),
  for the series itself, which lists all 39 episodes.
- `pages/` — the site's low-res English pages at 800px wide, JPEG q64:

| file | source |
|------|--------|
| `00.jpg` | [Episode 2, *Rainbow Potions*, page 1](https://www.peppercarrot.com/en/webcomic/ep02_Rainbow-potions.html) |
| `01.jpg` | Episode 2, page 2 |
| `02.jpg` | Episode 2, page 3 |
| `03.jpg` | Episode 2, page 4 |
| `04.jpg` | [Episode 1, *The Potion of Flight*, page 3](https://www.peppercarrot.com/en/webcomic/ep01_Potion-of-Flight.html) |
| `05.jpg` | Episode 1, page 1 |
| `06.jpg` | Episode 1, page 2 |

Episode 1 is whole, so that chapter reads as itself. Two of episode 2's pages are deliberately not
among these: the closing page is the patron credits panel rather than comic art, and page 5 is a
bath scene — fine in context, an odd thing to lead a project's README with. Every other episode is
read from these same seven pages, at its own length.

## Give My Regards to Black Jack, Shuho Sato — `works/black-jack.jpg`, `pages-manga/`

**The author's own free-use terms**, not a Creative Commons licence:
https://densho810.com/free/ (the terms are at the foot of that page, in Japanese and English).
Commercial and non-commercial reuse and adaptation are allowed without asking. What they require:

- **The title and author shown with the work, unaltered**: `Give My Regards to Black Jack`,
  `SHUHO SATO`. The mock series carries exactly those, and its pages are served only as that
  series' own.
- **Only the files that page distributes.** Both of ours come from its English volume 1
  (`enbj001.zip`): the cover is page 1, and `pages-manga/` is pages 7 and 10–16 of the first
  chapter at 800px wide. Pages 8, 9 and 17 onward are left out for what they show (an operation,
  then a road accident).
- **A report by email within a month of publishing a use** (`info@densho810.com`). This is the
  maintainer's to send; a script can't.
- Not the sequel (*New Give My Regards to Black Jack*) or any other of the author's works. Other
  readers' screenshots show some of those; these terms do not cover them.
- No listing on the Kindle store, and no free listing on any e-book store. Neither applies to a
  fixture, and both would to anything that shipped the volume as a book.

## Golden Age comic books — `works/planet-comics.jpg`, `works/wonderworld-comics.jpg`, `works/fantastic-comics.jpg`

**Public domain in the United States**: published there before 1964 and never renewed. That is
Wikimedia Commons' tag on each file, taken on its word; nobody here has searched the renewal
records, and it says nothing about any other country.

| file | cover | source |
|------|-------|--------|
| `planet-comics.jpg` | *Planet Comics* 1, January 1940, Lou Fine | [Commons](https://commons.wikimedia.org/wiki/File:Planet_Comics_no._1_(high-res).jpg) |
| `wonderworld-comics.jpg` | *Wonderworld Comics* 3, July 1939, Will Eisner and Lou Fine | [Commons](https://commons.wikimedia.org/wiki/File:WonderworldComics3.jpg) |
| `fantastic-comics.jpg` | *Fantastic Comics* 3, February 1940, Lou Fine | [Commons](https://commons.wikimedia.org/wiki/File:Fantastic_Comics_no._3.jpg) |

Each is a series of one issue, and its cover is the one page of it held. Covers from these years
need looking at one by one before another is added: the same shelves hold wartime caricature and
jungle titles, and some of the heroes' names are trademarks still in use.

## `thumbs/`, `fixture/`, `fixture-pages/` — drawn

Bridge icons, and the long-title fixture's cover and pages. Flat fields with one rounded motif,
everything derived from a seed, by `scripts/generate-mock-shapes.py`.

## Why not Little Nemo

The first version of the pages used *Little Nemo in Slumberland* (1907), which is public domain and
was chosen for exactly that reason. It was replaced because the licence was never the only question:
Impy, a recurring character, is a dark-skinned "jungle imp" drawn as the racial caricature that
period newspaper strips traded in, and he turns up across the run rather than in a few avoidable
strips — three of the six pages shipped here, and three of four replacement candidates pulled at
random. Public domain says nothing about whether art belongs on a project's front page. Anything
sourced from that era needs looking at panel by panel, and a modern CC-licensed comic skips the
problem entirely.
