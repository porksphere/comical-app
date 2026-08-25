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

## `pages/` — Little Nemo in Slumberland, Winsor McCay, 1907

Public domain. Published 1905–1914 in the *New York Herald*, so PD in the US under the pre-1929
rule; McCay died in 1934, so life+70 expired worldwide in 2005 as well. Sourced from Wikimedia
Commons, every file reporting `Public domain` in its licence field.

No attribution is legally required. The provenance is recorded anyway because it is the thing
nobody can reconstruct from the files themselves, and because "where did this art come from" is a
question worth being able to answer instantly.

| file | source |
|------|--------|
| `00.jpg` | [Little Nemo 1907-02-03](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-02-03.jpg) |
| `01.jpg` | [Little Nemo 1907-03-10](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-03-10.jpg) |
| `02.jpg` | [Little Nemo 1907-03-31](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-03-31.jpg) |
| `03.jpg` | [Little Nemo 1907-04-07](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-04-07.jpg) |
| `04.jpg` | [Little Nemo 1907-04-28](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-04-28.jpg) |
| `05.jpg` | [Little Nemo 1907-05-05](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-05-05.jpg) |

Downscaled to 800px wide, JPEG q64. The originals are ~1750x2300 and ~1MB each; at 800px the
lettering is still legible on a phone, which is the only bar that matters here.
