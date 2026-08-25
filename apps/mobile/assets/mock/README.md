# Mock catalog art

Only reachable from mock mode (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1` or the `__DEV__` Settings
toggle) — see `src/data/source.ts`. Wired up in `src/data/mock-assets.ts`.

These replaced live `picsum.photos` requests, which made the "comics" stock photographs of
skyscrapers and laptops — a different picture on every load, and a third-party service deciding
whether a grid rendered at all. Serving our own committed bytes keeps the network dependency but
makes the content deterministic, which was the half that mattered.

They are served, not bundled: `mock-assets.ts` builds jsDelivr URLs pointing at this directory at
a pinned commit, so nothing here reaches an app bundle. **Adding or redrawing art means bumping
that pin** (`REF` in `mock-assets.ts`) in the same commit that carries the new files; until then
the app renders the previous set.

Bundling was tried first and reverted. A bundled page resolves to a resource path in a release
build, and the download engine's `PageFetcher` (`src/data/downloads/fetch-page.ts`) resolves a
page to a `data:` URI or an http(s) URL — a resource path is neither, so downloading a mock
chapter had no working path. URLs are the shape every real source already hands it.

The cost is that mock mode is online-only.

## `covers/` — generated

24 PNGs from `scripts/generate-mock-covers.py`. Flat fields with one rounded motif, everything
derived from a seed. Rerun the script to change the design; the output is committed.

## `pages/` — Pepper&Carrot, David Revoy

**CC BY 4.0.** Attribution is a licence condition here, not a courtesy:

> *Pepper&Carrot* by David Revoy — https://www.peppercarrot.com — licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Downscaled and recompressed for use
> as fixtures; not otherwise altered.

| file | source |
|------|--------|
| `00.jpg` | [Episode 2, *Rainbow Potions*, page 1](https://www.peppercarrot.com/en/webcomic/ep02_Rainbow-potions.html) |
| `01.jpg` | Episode 2, page 2 |
| `02.jpg` | Episode 2, page 3 |
| `03.jpg` | Episode 2, page 4 |
| `04.jpg` | [Episode 1, *Potion of Flight*, page 3](https://www.peppercarrot.com/en/webcomic/ep01_Potion-of-Flight.html) |
| `05.jpg` | [Episode 1, *Potion of Flight*, page 1](https://www.peppercarrot.com/en/webcomic/ep01_Potion-of-Flight.html) |

Two of episode 2's pages are deliberately not among these: the closing page is the patron credits
panel rather than comic art, and page 5 is a bath scene — fine in context, an odd thing to lead a
project's README with. Downscaled to 800px wide, JPEG q64, from the site's own low-res exports.

### Why not Little Nemo

The first version of this set used *Little Nemo in Slumberland* (1907), which is public domain and
was chosen for exactly that reason. It was replaced because the licence was never the only question:
Impy, a recurring character, is a dark-skinned "jungle imp" drawn as the racial caricature that
period newspaper strips traded in, and he turns up across the run rather than in a few avoidable
strips — three of the six pages shipped here, and three of four replacement candidates pulled at
random. Public domain says nothing about whether art belongs on a project's front page. Anything
sourced from that era needs looking at panel by panel, and a modern CC-licensed comic skips the
problem entirely.
