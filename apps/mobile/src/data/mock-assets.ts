/**
 * The mock catalog's art, served out of this repo over jsDelivr — see `assets/mock/README.md` for
 * what the files are and where the comic pages come from.
 *
 * Serving beats bundling on the one axis that isn't taste: a bundled page resolves to a resource
 * path in a release build, and the download engine's `PageFetcher` (`downloads/fetch-page.ts`)
 * handles `data:` URIs and http(s) URLs only. Bundling made downloading a mock chapter
 * unrunnable; a URL is the shape every real source already hands it. Keeping ~5MB of fixtures
 * out of builds that can't reach them is the bonus, not the reason.
 *
 * `REF` follows `main` by default, and CI overrides it with the commit under test. That split is
 * what removes the manual step this used to carry: pinning a commit here meant every change to
 * `assets/mock/` also had to bump this line, and forgetting left the app serving the previous art
 * with nothing failing — a screenshot run shot the wrong covers exactly that way. `main` needs no
 * bump; the override is what keeps a branch's OWN art in its own screenshots and e2e runs, which a
 * bare `main` could not do.
 *
 * Consequence worth knowing: a branch that adds art shows `main`'s set anywhere the override isn't
 * set (local dev), until it merges.
 */
const REF = process.env.EXPO_PUBLIC_COMICAL_MOCK_REF || 'main';
const ASSETS = `https://cdn.jsdelivr.net/gh/porksphere/comical-app@${REF}/apps/mobile/assets/mock`;

const set = (dir: string, count: number, ext: string): string[] =>
  Array.from({ length: count }, (_, i) => `${ASSETS}/${dir}/${String(i).padStart(2, '0')}.${ext}`);

/** Pepper&Carrot's episode covers without their lettering, cut to 2:3 by
 *  `scripts/build-mock-art.py`. File `k` is the cover of `EPISODE_WORKS[k]` in `mock-works.ts`. */
export const MOCK_COVERS: string[] = set('covers', 24, 'jpg');

/** The episode covers that AREN'T a uniform 2:3, for the one bridge that serves those, so
 *  `SeriesCard`'s shrink animation has something to fire on (`VARIED_WORKS` in `mock-works.ts`). */
export const MOCK_COVERS_VARIED: string[] = set('covers-varied', 14, 'jpg');

/** A cover that carries its own title: one per named work (`NAMED_WORKS` in `mock-works.ts`). */
export const mockWorkCover = (name: string): string => `${ASSETS}/works/${name}.jpg`;

/** The fixture series' cover: drawn, since the series is invented (`scripts/generate-mock-shapes.py`). */
export const MOCK_FIXTURE_COVER = `${ASSETS}/fixture/00.png`;

/** The fixture series' pages, drawn likewise. */
export const MOCK_FIXTURE_PAGES: string[] = set('fixture-pages', 4, 'png');

/** Bridge list icons, drawn by `scripts/generate-mock-shapes.py`. */
export const MOCK_THUMBS: string[] = set('thumbs', 6, 'png');

/** Pepper&Carrot by David Revoy, CC BY 4.0. The licence requires attribution — it is carried in
 *  `assets/mock/README.md`, which is also where the note on why this isn't public-domain 1907
 *  newspaper art lives. */
export const MOCK_PAGES: string[] = set('pages', 7, 'jpg');

/** Give My Regards to Black Jack by Shuho Sato, in reading order. Its terms want the title and
 *  the author shown with the work, so these are served only as that series' own pages. */
export const MOCK_MANGA_PAGES: string[] = set('pages-manga', 8, 'jpg');
